/**
 * 叙事视图状态与层 z 的宿主侧装配：把引擎状态投影成模板可直接消费的响应式字段
 * （对话、选择、输入、NVL、元素表），并维护实例级 z 覆盖的响应式镜像。
 *
 * 引擎句柄与玩家偏好由调用方注入——本装配不持有引擎实例，重启重建引擎后经同一
 * 句柄读到新实例。打字机是宿主级单例（每句重建、逐帧消费、点击快进、重启清空都
 * 指向同一个实例），经返回的读写句柄与其它装配共享。
 */

import {
  SYS,
  instanceZLayer,
  resolveTextSpeed,
  type LayerId,
  type LayerZTable,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import {
  DEFAULT_TEXT_CPS,
  Typewriter,
  isTypingEnabled,
  type TypingSetting,
} from "@lingfan-engine/ui";
import { createNarrativeState } from "@lingfan-engine/shell";
import { createHostLayerZController } from "../runtime/layer-z";
import { vueCells } from "../runtime/vue-cells";
import type { VueNarrativeState } from "../runtime/narrative-state";

/** 打字机的宿主级共享句柄：当前句的读取与整体置空（重启时用） */
export interface TypewriterHandle {
  get: () => Typewriter | null;
  set: (value: Typewriter | null) => void;
}

/** 装配入参：引擎句柄、层 z 表、视频 z 下发与玩家偏好 */
export interface AppNarrativeOptions {
  /** 引擎句柄取用（角色配色、颜色覆盖读取；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 层 z 表：工程覆盖与内建默认的合成结果（组合根注入） */
  layerZ: LayerZTable;
  /** 视频 z 下发：视频层的 z 镜像变化时同步到视频端口 */
  applyVideoZ: (z: number) => void;
  /** 玩家偏好（打字机字速：每句重建时取当前值） */
  preferences: PlayerPreferences;
}

/** 叙事装配能力：共享叙事视图状态、层最终 z 与打字机句柄 */
export interface AppNarrative {
  /** 叙事视图状态（模板与各装配共享的响应式字段来源） */
  narrative: VueNarrativeState;
  /** 层最终 z（实例 > 层默认 > 内建）——模板直接用 */
  zOf: (layer: LayerId) => number;
  /** 打字机共享句柄 */
  typewriter: TypewriterHandle;
}

/** 装配叙事视图状态：订阅引擎状态投影成响应式字段，并装配层 z 控制与打字机 */
export function createAppNarrative(options: AppNarrativeOptions): AppNarrative {
  const { getEngine, layerZ, applyVideoZ, preferences } = options;
  let typewriter: Typewriter | null = null;
  /** 故事级打字机设置（`text_typewriter` 命令）：字速三级链的「故事」一级 */
  function readTypingSetting(): TypingSetting | undefined {
    return getEngine().get(SYS.typewriter) as TypingSetting | undefined;
  }
  // —— 视图状态：状态键 → 视图意图 → 响应式字段 ——
  // 解读规则来自共享的 shell 叙事状态域；这里只注入宿主侧事实（层级键、角色配色、打字机重建）
  // Vue 响应式单元经 vueCells 注入：ref/computed 结构上就是 Cell，零包装直传
  const narrative = createNarrativeState({
    cells: vueCells,
    resolveLayer: (key) => instanceZLayer(key),
    // 故事级打字机设置实装：字速与「整句直出」都认它（与另两宿主同口径）
    readTypingSetting,
    readCharacterColor: (name) => getEngine().getCharacter(name)?.color ?? null,
    readColorOverride: () => {
      const value = getEngine().get(SYS.currentDialogColor);
      return typeof value === "string" ? value : null;
    },
    onLayerZ: (layer, z) => {
      zController.set(layer, z);
    },
    onLayerZRestore: (z) => {
      zController.restore(z);
    },
    onDialogText: (line) => {
      // 字速三级链：偏好 > 故事 > 内建兜底（归属由偏好 textSpeedSource 声明，每句现读）。
      // enabled=false 整句直出（typewriter=null，帧循环与点击都按 null 走直出分支）；
      // 玩家 instantText 偏好同样整句直出（无障碍/效率），只关显示速度不改推进语义。
      const setting = readTypingSetting();
      if (!isTypingEnabled(setting) || preferences.instantText) {
        typewriter = null;
        return;
      }
      const cps = resolveTextSpeed({
        player: preferences.textSpeed,
        source: preferences.textSpeedSource,
        story: setting?.speed,
        fallback: DEFAULT_TEXT_CPS,
      });
      typewriter = new Typewriter(line, cps);
    },
  });
  /**
   * 层 z 镜像控制器：实例级覆盖的**响应式镜像** + 视频层下发。
   * 镜像必须响应式——模板绑定读它，才会在该层 z 变化时重渲染。
   */
  const zController = createHostLayerZController({
    layerZ,
    applyVideoZ,
  });
  /** 层最终 z（实例 > 层默认 > 内建） */
  function zOf(layer: LayerId): number {
    return zController.zOf(layer);
  }
  return {
    // 注入的单元就是 Vue ref/computed（vue-cells.ts），模板解包与类型检查按 Vue 语义命名
    narrative: narrative as unknown as VueNarrativeState,
    zOf,
    typewriter: {
      get: () => typewriter,
      set: (value) => {
        typewriter = value;
      },
    },
  };
}
