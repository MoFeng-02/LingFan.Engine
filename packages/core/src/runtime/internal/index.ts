/**
 * 运行层内部结构：执行帧、检查点、命令处理器看到的状态面，以及门面与解释执行共用的零件。
 * 只在运行层内部使用，不进包出口。
 */
export type { Checkpoint, EngineSnapshot, Frame, LoopState } from "./frame.ts";
export {
  cloneFrame,
  GuardFailure,
  parseMenuReturn,
  sameCoord,
  snapshotText,
  validSlot,
} from "./helpers.ts";
export {
  beginLoopIteration,
  columnById,
  enterColumn,
  nearestLoopIndex,
  pushIterateLoop,
} from "./frame-stack.ts";
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
} from "./session.ts";
export { abortExternalTakeovers, clearTimer, input } from "./waiting.ts";
export {
  animationFinished,
  animations,
  reportMediaPosition,
  shakeFinished,
  transitionFinished,
  videoFinished,
} from "./media.ts";
export {
  elements,
  findElements,
  getCharacter,
  getCharacters,
  interpolate,
  mapElements,
} from "./stage.ts";
export { draw, evalCond } from "./expression.ts";
export type { OpContext } from "./context.ts";
