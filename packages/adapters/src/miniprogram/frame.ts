/**
 * 帧源（小程序）：把 canvas 的 `requestAnimationFrame` 面接成 `@lingfan/ui` 的 `FrameSource`。
 * 本包不依赖 `@lingfan/ui`（那是界面层，反过来依赖会让依赖方向倒置），所以这里返回**结构一致**
 * 的对象：`request(now) → 句柄` / `cancel(句柄)`；兼容性由调用点用类型标注校验
 * （`tests/adapters/miniprogram/frame.test.ts` 有这条互锁）。
 */
import type { MiniprogramCanvasFrameLike } from "./platform.ts";

/**
 * 与 `@lingfan/ui` 的 `FrameSource` 结构一致；注意上层把句柄 `0` 当作「无句柄」，
 * 帧面实现不应返回 0。
 */
export interface MiniprogramFrameSource {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

/**
 * 造一个帧源（小程序）。
 * @param canvas 帧面：宿主注入 `canvas.requestAnimationFrame`（或全局 rAF 的等价包装）
 */
export function createMiniprogramFrameSource(
  canvas: MiniprogramCanvasFrameLike,
): MiniprogramFrameSource {
  return {
    request: (callback) => canvas.requestAnimationFrame(callback),
    cancel: (handle) => canvas.cancelAnimationFrame(handle),
  };
}
