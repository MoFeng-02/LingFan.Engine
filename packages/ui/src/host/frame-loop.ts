/**
 * 帧循环：把「每帧要推进的事情」编排成一次连续续帧的循环。
 *
 * 推进什么由注入的 `onTick` 决定，本模块只管排帧、算 `dt` 与三种收尾：
 * - `start()` 幂等；`stop()` 不可逆（卸载收尾）；`setRunning()` 是运行中的暂停/恢复，
 *   恢复时重置时间基准，暂停的时长不会被算进下一帧的 `dt`。
 * - 帧源（`requestAnimationFrame` 或宿主的等价物）由外部注入——本模块不认平台 API，
 *   也不自己计时：`dt` 由帧源给的时间戳算出。
 * - 首帧没有上一帧可比，`dt` 记 0：否则开场会凭空多推进一段时间。
 */

/** 帧源：宿主把平台的「下一帧」能力包成这两个方法 */
export interface FrameSource {
  /** 申请下一帧；回调收到帧源自己的时间原点（毫秒） */
  request(callback: (now: number) => void): number;
  /** 取消已申请的帧（句柄来自 `request` 的返回值） */
  cancel(handle: number): void;
}

/** 帧循环的输入：帧源 + 每帧要推进的一件事 */
export interface FrameLoopOptions {
  frame: FrameSource;
  /** 推进一帧；`dtSeconds` 是距上一帧的秒数（首帧为 0） */
  onTick(dtSeconds: number): void;
}

/**
 * 帧循环句柄：`start()` 后续帧自动申请，直到 `stop()`（不可逆）或 `setRunning(false)`。
 *
 * 句柄只暴露这三个开关，推进顺序由装配方的 `onTick` 固定，循环本身不猜任何业务。
 */
export interface FrameLoop {
  /** 启动循环：已在运行或已卸载时为空操作 */
  start(): void;
  /** 不可逆地停帧并取消已排定的帧（卸载时调用） */
  stop(): void;
  /** 运行中的暂停/恢复；恢复时会重置时间基准 */
  setRunning(running: boolean): void;
}

/**
 * 创建帧循环：帧源与每帧动作全部由外部注入，故本模块可被任何渲染宿主复用
 * （覆盖层与各宿主的 `startHostFrameLoop` 都建在它之上）。
 */
export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  let handle = 0;
  let last = 0;
  let running = false;
  let disposed = false;

  const frame = (now: number): void => {
    if (!running) return;
    const dt = last > 0 ? (now - last) / 1000 : 0;
    last = now;

    options.onTick(dt);

    // `stop()` 可能发生在帧内（如加载失败）：那时不再续帧
    if (running) handle = options.frame.request(frame);
  };

  return {
    start(): void {
      if (running || disposed) return;
      running = true;
      handle = options.frame.request(frame);
    },
    stop(): void {
      if (disposed) return;
      disposed = true;
      running = false;
      if (handle !== 0) options.frame.cancel(handle);
      handle = 0;
      last = 0;
    },
    setRunning(next: boolean): void {
      if (disposed || next === running) return;
      running = next;
      // 暂停的时长不算进下一帧：恢复时丢掉上一次的基准
      last = 0;
      if (running) handle = options.frame.request(frame);
    },
  };
}
