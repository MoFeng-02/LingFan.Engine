/**
 * 帧驱动表现与 rAF 帧循环的宿主侧装配：核心只写「描述」（离散、进快照），逐帧
 * 插值归宿主层叶子（不逐帧写 SSOT）。帧内顺序（推进打字机 → 上交可见文本 →
 * 媒体位置回写 → 帧驱动表现）在这里固定。
 *
 * 打字机为空时用正文兜底：整句直出（不经打字机）也得上屏。
 */

import { type Ref } from "vue";
import {
  resolveReducedMotion,
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import { type FrameSource } from "@lingfan-engine/ui";
import { startHostFrameLoop as startLoop } from "@lingfan-engine/shell";
import { createHostEffects } from "../elements/effects";
import type { AppMedia } from "../media/app-media";
import type { VueNarrativeState } from "../../narrative/runtime/narrative-state";
import type { TypewriterHandle } from "../../narrative/wiring/app-narrative";

/** 装配入参：引擎句柄、叙事状态、媒体单元格与表现层目标元素 */
export interface AppFrameOptions {
  /** 引擎句柄取用（动画/转场/震动描述读取与完成回传；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 帧源（组合根注入：浏览器宿主给 rAF 帧源，小程序宿主给画布帧源） */
  frame: FrameSource;
  /** 叙事视图状态（正文与可见文本字段） */
  narrative: VueNarrativeState;
  /** 媒体单元格（音频位置逐帧回写） */
  media: AppMedia;
  /** 打字机共享句柄（逐帧推进与读取） */
  typewriter: TypewriterHandle;
  /** 舞台元素层容器（元素动画的宿主） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 全屏转场遮罩（不透明度与显隐由帧驱动写入） */
  transitionEl: Ref<HTMLElement | null>;
  /** 震动落点（内容层容器：偏移写它的 transform，别写套着适配变换的舞台根） */
  shakeEl: Ref<HTMLElement | null>;
  /** 玩家偏好（可选）：转场/动画时长倍率、震动强度倍率、减少动态，逐帧现读 */
  preferences?: PlayerPreferences;
  /**
   * 系统「减弱动效」读面（可选）：宿主测 `prefers-reduced-motion` 媒体查询注入。
   * 玩家未显式设置时跟随系统；逐帧现读，系统设置变化即时生效。
   */
  readSystemReducedMotion?: () => boolean;
}

/** 帧驱动能力：可停止的 rAF 帧循环句柄 */
export interface AppFrame {
  /** rAF 帧循环句柄（卸载期停止） */
  frameLoop: ReturnType<typeof startLoop>;
}

/** 装配帧驱动：启动 rAF 循环，逐帧串起打字机、媒体回写与舞台表现 */
export function createAppFrame(options: AppFrameOptions): AppFrame {
  const {
    getEngine,
    frame,
    narrative,
    media,
    typewriter,
    elementLayerEl,
    transitionEl,
    shakeEl,
    preferences,
    readSystemReducedMotion,
  } = options;
  const { text, shownText } = narrative;
  // —— 帧驱动表现：元素动画 / 全屏转场 / 屏幕震动 ——
  // 核心只写「描述」（离散、进快照），逐帧插值归宿主层叶子（不逐帧写 SSOT）。
  const driveEffects = createHostEffects({
    source: {
      animations: () => getEngine().animations(),
      transition: () => {
        const live = getEngine().get(SYS.transition) as
          { duration: number } | null | undefined;
        return live ?? undefined;
      },
      shake: () => {
        const live = getEngine().get(SYS.shake) as
          { intensity: number; duration: number } | null | undefined;
        return live ?? undefined;
      },
      animationFinished: (seq) => {
        getEngine().animationFinished(seq);
      },
      transitionFinished: () => {
        getEngine().transitionFinished();
      },
      shakeFinished: () => {
        getEngine().shakeFinished();
      },
    },
    readElementHost: () => elementLayerEl.value,
    readOverlay: () => transitionEl.value,
    readStage: () => shakeEl.value,
    // 玩家运动偏好：只乘算时长/强度、开关减少动态，不改引擎描述值（SSOT 仍是作者的）
    motion:
      preferences === undefined
        ? undefined
        : {
            transitionSpeed: () => preferences.transitionSpeed,
            shakeScale: () => preferences.shakeScale,
            // 三态合成：玩家显式 true/false 覆盖系统；玩家未设置（undefined）跟随系统
            // 媒体查询。不再把 undefined 塌缩成 false 跳过系统层（无障碍「跟随系统」语义）。
            reducedMotion: () =>
              resolveReducedMotion({
                player: preferences.reducedMotion,
                system: readSystemReducedMotion?.(),
              }),
          },
  });
  // —— 共享帧循环驱动打字机（帧源由组合根注入，本文件不认平台帧 API）——
  // 帧内顺序（推进打字机 → 上交可见文本 → 媒体位置回写 → 帧驱动表现）。
  // 打字机为空时用正文兜底：整句直出（不经打字机）也得上屏。
  const frameLoop = startLoop({
    frame,
    readTypewriter: () => typewriter.get(),
    onText: (visible) => {
      shownText.value = typewriter.get() === null ? text.value : visible;
    },
    onMediaTick: () => {
      media.audioRenderer?.pollPosition();
    },
    onFrame: (dt) => {
      driveEffects(dt);
    },
  });
  return { frameLoop };
}
