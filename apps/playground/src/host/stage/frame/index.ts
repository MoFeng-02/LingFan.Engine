/** 帧循环叶子件：帧装配、共享帧循环装配与本宿主的帧源。 */
export type { AppFrame, AppFrameOptions } from "./app-frame.ts";
export { createAppFrame } from "./app-frame.ts";
export { browserFrameSource } from "./frame-loop.ts";
export {
  startHostFrameLoop,
  type HostFrameLoopOptions,
} from "@lingfan-engine/shell";
