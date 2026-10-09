/**
 * 本宿主的帧循环：把浏览器 rAF 适配成共享帧循环要的帧源，并在装配期直接起转。
 *
 * 时间线与每帧的推进顺序由共享实现固定（打字机推进 → 上交可见文本 → 媒体回写 → 帧驱动表现），
 * 本模块只提供帧源与启动动作。
 *
 * `onText` 每帧无条件上交打字机的可见前缀，没有打字机时上交空串——整句直出时打字机可能已被丢弃，
 * 所以调用方要自己用当前句文本兜底，不能把空串直接当成上屏内容。
 */
import { createFrameLoop, type FrameLoop } from "@lingfan/ui";

/** 本宿主帧循环需要的回调；帧源由本模块内建 */
export interface HostFrameLoopOptions {
  /** 取当前打字机；返回 null 表示本帧没有打字机 */
  readTypewriter(): { tick(dtSeconds: number): void; readonly visible: string } | null;
  /** 每帧上交打字机可见前缀（无打字机时为空串，由调用方决定怎么兜底） */
  onText(visible: string): void;
  /** 媒体位置回写（播放进度轮询等） */
  onMediaTick(): void;
  /** 帧驱动表现（元素动画 / 全屏转场 / 屏幕震动） */
  onFrame(dt: number): void;
}

/**
 * 起转帧循环：以浏览器 rAF 为帧源，返回的句柄可随时 `stop()`。
 *
 * 重复起转由共享实现挡住（已在运行则原样返回），调用方不必自己判重。
 */
export function startHostFrameLoop(options: HostFrameLoopOptions): FrameLoop {
  const loop = createFrameLoop({
    frame: {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
    readTypewriter: () => options.readTypewriter(),
    onText: (visible) => {
      options.onText(visible);
    },
    onMediaTick: () => {
      options.onMediaTick();
    },
    onFrame: (dt) => {
      options.onFrame(dt);
    },
  });
  loop.start();
  return loop;
}
