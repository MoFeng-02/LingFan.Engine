/**
 * 帧源装配：叙事覆盖层每帧只要一个「下一帧」回调，帧从哪来由宿主决定。
 *
 * 有画布节点就用它的 requestAnimationFrame（与真机刷新同步、后台自动停），
 * 没有就退回定时器（约 60 帧/秒）。两条路都满足同一个 `FrameSource` 形状，
 * 上层装配器与帧循环不需要知道用的是哪条。
 */
import {
  createMiniprogramFrameSource,
  type MiniprogramFrameSource,
} from "@lingfan/adapters";
import { uniApi, type MiniprogramCanvasNode } from "./platform.ts";

/** 定时器帧源的间隔（毫秒）：约 60 帧/秒，与常见屏幕刷新率一致 */
const TIMER_FRAME_MS = 16;

/** 造帧源：给画布就走画布，否则走定时器 */
export function createHostFrameSource(
  canvas: MiniprogramCanvasNode | null,
): MiniprogramFrameSource {
  return canvas !== null
    ? createMiniprogramFrameSource(canvas)
    : createTimerFrameSource();
}

/**
 * 定时器帧源：句柄从 1 起编（0 留给「无句柄」的既有约定），取消时清掉在排的定时器。
 */
function createTimerFrameSource(): MiniprogramFrameSource {
  const api = uniApi();
  const pending = new Map<number, number>();
  let nextHandle = 1;
  return {
    request(callback: (now: number) => void): number {
      const handle = nextHandle;
      nextHandle += 1;
      const timer = api.setTimeout(() => {
        pending.delete(handle);
        callback(Date.now());
      }, TIMER_FRAME_MS);
      pending.set(handle, timer);
      return handle;
    },
    cancel(handle: number): void {
      const timer = pending.get(handle);
      if (timer === undefined) return;
      api.clearTimeout(timer);
      pending.delete(handle);
    },
  };
}
