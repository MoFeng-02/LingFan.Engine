/**
 * 帧循环接线：把 `requestAnimationFrame` 接到展示层的帧循环上。
 *
 * 帧源是本宿主唯一认识平台 API 的地方——展示层的帧循环只认「申请下一帧 / 取消」两个方法，
 * 换平台（小游戏运行时、测试用的假帧源）只改这里。
 *
 * 每帧顺序固定：打字机推进 → 上交可见文本 → 媒体位置回写 → 帧驱动表现。
 * 先上屏再写表现，否则同一帧里的动画会看到上一帧的文本。
 */

import { createFrameLoop, type FrameLoop } from "@lingfan/ui";
import type { DialogueView } from "./dialogue-view";

/** 帧循环的输入：对话视图（打字机与上屏都经它）与两项每帧回调 */
export interface HostFrameLoopOptions {
  /** 对话视图：打字机实例与可见文本上屏都经它 */
  dialogue: DialogueView;
  /** 媒体位置帧级回写（音频端口自带的做法） */
  onMediaTick(): void;
  /** 帧驱动表现；传入距上一帧的秒数 */
  onFrame(dt: number): void;
}

/** 启动帧循环并返回句柄（本宿主不主动停帧，句柄留给需要停的场合） */
export function startHostFrameLoop(options: HostFrameLoopOptions): FrameLoop {
  const loop = createFrameLoop({
    frame: {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
    readTypewriter: () => options.dialogue.readTypewriter(),
    onText: (visible) => options.dialogue.onText(visible),
    onMediaTick: () => options.onMediaTick(),
    onFrame: (dt) => options.onFrame(dt),
  });
  loop.start();
  return loop;
}
