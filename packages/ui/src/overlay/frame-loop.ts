/**
 * 帧循环：驱动打字机推进，并把每帧时刻交给宿主。
 *
 * 引擎核心不驱动帧（帧归宿主），覆盖层就是那个宿主：它持帧循环，做打字插值与
 * 层级无关的每帧回调，**不逐帧写引擎状态**（帧级高频键由引擎自己的静默写通道负责）。
 *
 * 停帧与卸载是两条不同的路径：`setRunning(false)` 只停帧（宿主游戏暂停时避免空转），
 * 之后再 `setRunning(true)` 可恢复；`stop()` 是不可逆的卸载收尾，停帧后不再重启。
 * 帧能力由 `FrameSource` 注入（无 rAF 的环境下帧源不回调，循环静默不启、功能仍可用）。
 */
import type { FrameSource } from "../host/frame-loop";

export interface FrameLoopDeps {
  /** 帧源（宿主平台能力；无帧环境由端口给一个永不回调的帧源） */
  frame: FrameSource;
  /** 推进打字机一帧；返回可见前缀是否变化（变了才需要重渲正文） */
  tickTypewriter: (dtSeconds: number) => boolean;
  /** 打字进度变化时重渲正文并通知宿主投影变化 */
  onTyped: () => void;
  /** 宿主每帧回调（用于把覆盖层与宿主引擎的位置对齐） */
  onFrame?: (dtSeconds: number) => void;
}

/**
 * 帧循环的三个开关。`start` 只能调一次且应在装配末尾；`stop` 是卸载收尾，
 * 一旦调过就不再续帧；运行中的暂停/恢复走 `setRunning`，恢复时会重置时间基准，
 * 因此暂停的时长不会被算进下一帧的 `dt`。
 */
export interface FrameLoop {
  /** 启动循环（帧源不回调时自动作废） */
  start(): void;
  /** 不可逆地停帧并取消已排定的帧（卸载时调用） */
  stop(): void;
  /** 帧循环开关（宿主游戏暂停时可关，避免空转） */
  setRunning(running: boolean): void;
}

/**
 * 造一个帧循环：工厂只持有句柄与时间基准，推进什么由 `deps.tickTypewriter` 决定。
 *
 * 首帧由 `start` 排定，之后每帧在处理完当帧工作后自行续排；末帧句柄记在闭包里，
 * `stop` 与 `setRunning` 都复用它，不会误取消别的循环。
 * 每个实例一份状态，多个覆盖层同时存在也互不影响。
 */
export function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  let rafId = 0;
  let lastFrame = 0;
  let running = true;
  let disposed = false;

  function frame(now: number): void {
    if (disposed) return;
    if (!running) return;
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    if (deps.tickTypewriter(dt)) deps.onTyped();
    deps.onFrame?.(dt);
    rafId = deps.frame.request(frame);
  }

  return {
    start(): void {
      rafId = deps.frame.request(frame);
    },
    stop(): void {
      disposed = true;
      running = false;
      if (rafId !== 0) deps.frame.cancel(rafId);
    },
    setRunning(next: boolean): void {
      if (next === running) return;
      running = next;
      lastFrame = 0;
      if (running && !disposed) rafId = deps.frame.request(frame);
    },
  };
}
