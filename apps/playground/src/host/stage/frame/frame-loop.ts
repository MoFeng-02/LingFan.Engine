/**
 * 本宿主的帧源：把浏览器 rAF 适配成共享帧循环要的帧源。
 *
 * 时间线与每帧的推进顺序由共享实现固定（`@lingfan-engine/shell` 的 `startHostFrameLoop`），
 * 本模块只提供浏览器那一份帧源；小程序宿主另给画布帧源。
 */
import type { FrameSource } from "@lingfan-engine/ui";

/** 浏览器帧源：把 rAF 与取消包成共享帧循环要的两个方法 */
export function browserFrameSource(): FrameSource {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}
