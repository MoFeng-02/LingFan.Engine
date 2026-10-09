/**
 * 命令处理器域的出口。
 *
 * 执行器与运行层内部模块统一从这里取处理器；域内各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export { execExtensionOp } from "./extension";
export {
  execCharacter,
  execMenu,
  execNvl,
  execSay,
  execWait,
  isValidSayColor,
} from "./dialog";
export { execCall, execFunc, execNavigate, execReturn } from "./call";
export {
  execAssert,
  execFor,
  execForeach,
  execGuard,
  execIf,
  execSwitch,
  execWhile,
} from "./flow";
export {
  execArray,
  execArrayPop,
  execArrayPush,
  execAssign,
  execDefine,
  execDict,
  execDictSet,
  execRandom,
  execUndef,
} from "./variables";
export { execAudio, execNotify, execVideo } from "./media";
export {
  execAnimate,
  execElementVisual,
  execScreenEffect,
  execTextTypewriter,
  execWindow,
  runElementOps,
} from "./element";
export {
  execAutoSaveOp,
  execLoadOp,
  execSaveDeleteOp,
  execSaveOp,
} from "./save";
export { abortInteraction, execInput, execInteraction, resolveInteraction } from "./interaction";
export { abortMinigame, execMinigame, resolveMinigame } from "./minigame";
