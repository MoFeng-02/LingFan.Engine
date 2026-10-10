/**
 * 帧驱动表现与 rAF 帧循环的宿主侧装配：核心只写「描述」（离散、进快照），逐帧
 * 插值归宿主层叶子（不逐帧写 SSOT）。帧内顺序（推进打字机 → 上交可见文本 →
 * 媒体位置回写 → 帧驱动表现）在这里固定。
 *
 * 打字机为空时用正文兜底：整句直出（不经打字机）也得上屏。
 */

import { type Ref } from "vue";
import { SYS, type StoryEngine } from "@lingfan/engine";
import { createHostEffects } from "./effects";
import { startHostFrameLoop as startLoop } from "./frame-loop";
import type { AppMedia } from "./app-media";
import type { NarrativeState } from "./narrative-state";
import type { TypewriterHandle } from "./app-narrative";

/** 装配入参：引擎句柄、叙事状态、媒体单元格与表现层目标元素 */
export interface AppFrameOptions {
  /** 引擎句柄取用（动画/转场/震动描述读取与完成回传；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 叙事视图状态（正文与可见文本字段） */
  narrative: NarrativeState;
  /** 媒体单元格（音频位置逐帧回写） */
  media: AppMedia;
  /** 打字机共享句柄（逐帧推进与读取） */
  typewriter: TypewriterHandle;
  /** 舞台元素层容器（元素动画的宿主） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 全屏转场遮罩（不透明度与显隐由帧驱动写入） */
  transitionEl: Ref<HTMLElement | null>;
  /** 舞台根（震动偏移写它的 transform） */
  stageEl: Ref<HTMLElement | null>;
}

/** 帧驱动能力：可停止的 rAF 帧循环句柄 */
export interface AppFrame {
  /** rAF 帧循环句柄（卸载期停止） */
  frameLoop: ReturnType<typeof startLoop>;
}

/** 装配帧驱动：启动 rAF 循环，逐帧串起打字机、媒体回写与舞台表现 */
export function createAppFrame(options: AppFrameOptions): AppFrame {
  const { getEngine, narrative, media, typewriter, elementLayerEl, transitionEl, stageEl } =
    options;
  const { text, shownText } = narrative;
  // —— 帧驱动表现：元素动画 / 全屏转场 / 屏幕震动 ——
  // 核心只写「描述」（离散、进快照），逐帧插值归宿主层叶子（不逐帧写 SSOT）。
  const driveEffects = createHostEffects({
    source: {
      animations: () => getEngine().animations(),
      transition: () => {
        const live = getEngine().get(SYS.transition) as { duration: number } | null | undefined;
        return live ?? undefined;
      },
      shake: () => {
        const live = getEngine().get(SYS.shake) as
          | { intensity: number; duration: number }
          | null
          | undefined;
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
    readStage: () => stageEl.value,
  });
  // —— rAF 帧循环驱动打字机 ——
  // 帧内顺序（推进打字机 → 上交可见文本 → 媒体位置回写 → 帧驱动表现）。
  // 打字机为空时用正文兜底：整句直出（不经打字机）也得上屏。
  const frameLoop = startLoop({
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
