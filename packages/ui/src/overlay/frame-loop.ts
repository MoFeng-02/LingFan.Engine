/**
 * 帧循环：驱动打字机推进，并把每帧时刻交给宿主。
 *
 * 引擎核心不驱动帧（帧归宿主），覆盖层就是那个宿主：它持 rAF，做打字插值与
 * 层级无关的每帧回调，**不逐帧写引擎状态**（帧级高频键由引擎自己的静默写通道负责）。
 *
 * 停帧与卸载是两条不同的路径：`setRunning(false)` 只停帧（宿主游戏暂停时避免空转），
 * 之后再 `setRunning(true)` 可恢复；`stop()` 是不可逆的卸载收尾，停帧后不再重启。
 * 无 rAF 的环境（测试/降级）下静默不启，功能仍可用。
 */
export interface FrameLoopDeps {
  /** 建循环时读到的窗口（用于启动、取消与恢复；可能为 `null` = 无 rAF 环境） */
  view: Window | null | undefined;
  /**
   * 每帧重新解析窗口（引擎不要求同步 DOM 结构，宿主换文档时仍取当帧的窗口）。
   * 与 `view` 分开是有意为之：原语义就是「启动读一次、之后每帧重读」。
   */
  readView: () => Window | null | undefined;
  /** 推进打字机一帧；返回可见前缀是否变化（变了才需要重渲正文） */
  tickTypewriter: (dtSeconds: number) => boolean;
  /** 打字进度变化时重渲正文并通知宿主投影变化 */
  onTyped: () => void;
  /** 宿主每帧回调（用于把覆盖层与宿主引擎的位置对齐） */
  onFrame?: (dtSeconds: number) => void;
}

export interface FrameLoop {
  /** 启动循环（无 rAF 环境自动跳过） */
  start(): void;
  /** 不可逆地停帧并取消已排定的帧（卸载时调用） */
  stop(): void;
  /** 帧循环开关（宿主游戏暂停时可关，避免空转） */
  setRunning(running: boolean): void;
}

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
    rafId = deps.readView()?.requestAnimationFrame(frame) ?? 0;
  }

  return {
    start(): void {
      const view = deps.view;
      if (view !== null && view !== undefined) {
        rafId = view.requestAnimationFrame(frame);
      }
    },
    stop(): void {
      disposed = true;
      running = false;
      if (rafId !== 0) deps.view?.cancelAnimationFrame(rafId);
    },
    setRunning(next: boolean): void {
      if (next === running) return;
      running = next;
      lastFrame = 0;
      const view = deps.view;
      if (running && !disposed && view !== null && view !== undefined) {
        rafId = view.requestAnimationFrame(frame);
      }
    },
  };
}
