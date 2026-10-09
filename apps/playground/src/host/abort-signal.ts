import type { AbortHandle } from "@lingfan/engine";

/**
 * 中止句柄收窄（宿主侧）：契约层只用语言核心类型，只承诺 `signal.aborted` 可轮询；
 * 本宿主（浏览器）拿到的其实是 `AbortSignal` 实例，需要订阅中止事件时就收窄回来。
 * 只做类型收窄，运行时对象不变——引擎给的就是宿主环境自己的中止实现。
 */
export function abortSignalOf(handle: AbortHandle): AbortSignal {
  return handle as AbortSignal;
}
