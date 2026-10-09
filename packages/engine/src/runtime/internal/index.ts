/**
 * 运行层内部结构：执行帧、检查点、命令处理器看到的状态面，以及门面与解释执行共用的零件。
 * 只在运行层内部使用，不进包出口。
 */
export type { Checkpoint, EngineSnapshot, Frame, LoopState } from "./frame";
export { cloneFrame, GuardFailure, parseMenuReturn, sameCoord, snapshotText, validSlot } from "./helpers";
export {
  beginLoopIteration,
  columnById,
  enterColumn,
  nearestLoopIndex,
  pushIterateLoop,
} from "./frame-stack";
export {
  advance,
  choose,
  dispose,
  load,
  navigate,
  onEvent,
  onStateChanged,
  reloadStory,
  save,
  setLanguage,
  start,
} from "./session";
export {
  abortExternalTakeovers,
  clearTimer,
  input,
} from "./waiting";
export {
  animationFinished,
  animations,
  reportMediaPosition,
  shakeFinished,
  transitionFinished,
  videoFinished,
} from "./media";
export {
  elements,
  findElements,
  getCharacter,
  getCharacters,
  interpolate,
  mapElements,
} from "./stage";
export {
  draw,
  evalCond,
} from "./expression";
export type { OpContext } from "./context";
