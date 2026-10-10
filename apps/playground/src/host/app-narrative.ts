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
  type LayerId,
  type LayerZTable,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan/engine";
import { Typewriter } from "@lingfan/ui";
import { createLayerZController } from "./layer-z";
import { createNarrativeState, type NarrativeState } from "./narrative-state";

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
  narrative: NarrativeState;
  /** 层最终 z（实例 > 层默认 > 内建）——模板直接用 */
  zOf: (layer: LayerId) => number;
  /** 打字机共享句柄 */
  typewriter: TypewriterHandle;
}

/** 装配叙事视图状态：订阅引擎状态投影成响应式字段，并装配层 z 控制与打字机 */
export function createAppNarrative(options: AppNarrativeOptions): AppNarrative {
  const { getEngine, layerZ, applyVideoZ, preferences } = options;
  let typewriter: Typewriter | null = null;
  // —— 视图状态：状态键 → 视图意图 → 响应式字段 ——
  // 解读规则来自共享的叙事状态域；这里只注入宿主侧事实（层级键、角色配色、打字机重建）
  const narrative = createNarrativeState({
    resolveLayer: (key) => instanceZLayer(key),
    // 本宿主不提供故事级打字机设置：字速一律取玩家偏好
    readTypingSetting: () => undefined,
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
      // 打字速度 = 玩家偏好（SetTextSpeed 语义；每句重建取最新值）
      typewriter = new Typewriter(line, preferences.textSpeed);
    },
  });
  /**
   * 层 z 控制器：实例级覆盖的**响应式镜像** + 视频层下发。
   * 镜像必须响应式——模板绑定读它，才会在该层 z 变化时重渲染。
   */
  const zController = createLayerZController({
    layerZ,
    applyVideoZ,
  });
  /** 层最终 z（实例 > 层默认 > 内建） */
  function zOf(layer: LayerId): number {
    return zController.zOf(layer);
  }
  return {
    narrative,
    zOf,
    typewriter: {
      get: () => typewriter,
      set: (value) => {
        typewriter = value;
      },
    },
  };
}
