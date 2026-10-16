/** 宿主帧循环域：帧源由宿主注入，推进顺序与收尾语义在这里固定。 */

export {
  startHostFrameLoop,
  type HostFrameLoopOptions,
} from "./appFrameLoop.ts";
