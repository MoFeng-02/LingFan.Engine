/**
 * 帧循环：把「每帧要推进的事情」编排成一次连续续帧的循环。
 *
 * 顺序固定——打字机推进 → 上交本句可见文本 → 媒体位置回写 → 帧驱动表现：
 * 文本先上屏再写表现，否则同一帧里的动画会看到上一帧的文本。
 *
 * 「可见文本是否真的变化了」留一半给宿主：整句直出（关打字机）不走帧循环，宿主必须
 * 自己记住当前上屏的文本，才不会在下一帧被判定为「已最新」而漏清旧句。本模块因此
 * 每帧无条件上交 `visible`，由宿主决定写不写。
 *
 * 帧源（`requestAnimationFrame` 或宿主的等价物）由外部注入——本模块不认平台 API，
 * 也不自己计时：`dt` 由帧源给的时间戳算出。
 */

/** 帧源：宿主把平台的「下一帧」能力包成这两个方法 */
export interface FrameSource {
  /** 申请下一帧；回调收到帧源自己的时间原点（毫秒） */
  request(callback: (now: number) => void): number;
  /** 取消已申请的帧（句柄来自 `request` 的返回值） */
  cancel(handle: number): void;
}

/** 帧循环的输入：帧源 + 每帧要推进的四件事（顺序即此处的声明顺序） */
export interface FrameLoopOptions {
  frame: FrameSource;
  /** 读当前打字机（整句直出时为 null）；用 getter 保证每句重建后拿到的是最新实例 */
  readTypewriter(): { tick(dtSeconds: number): void; readonly visible: string } | null;
  /** 上交本句当前的可见文本（每帧一次；是否重写 DOM 由宿主判定） */
  onText(visible: string): void;
  /** 媒体位置帧级回写（音频/视频端口自带的做法） */
  onMediaTick(): void;
  /** 帧驱动表现；传入距上一帧的秒数 */
  onFrame(dt: number): void;
}

/** 帧循环句柄：`start()` 后续帧自动申请，直到 `stop()` */
export interface FrameLoop {
  start(): void;
  stop(): void;
}

/**
 * 创建帧循环：`start()` 后每帧推进一次，直到 `stop()`。
 * 帧源与每帧动作全部由外部注入，故本模块可被任何渲染宿主复用。
 */
export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  let handle = 0;
  let running = false;
  let last = 0;

  const frame = (now: number): void => {
    // 首帧没有上一帧可比，`dt` 记 0：否则开场会凭空多推进一段时间
    const dt = last > 0 ? (now - last) / 1000 : 0;
    last = now;

    const typewriter = options.readTypewriter();
    typewriter?.tick(dt);
    options.onText(typewriter?.visible ?? "");

    options.onMediaTick();
    options.onFrame(dt);

    // `stop()` 可能发生在帧内（如加载失败）：那时不再续帧
    if (running) handle = options.frame.request(frame);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      handle = options.frame.request(frame);
    },
    stop(): void {
      if (!running) return;
      running = false;
      options.frame.cancel(handle);
      handle = 0;
      last = 0;
    },
  };
}
