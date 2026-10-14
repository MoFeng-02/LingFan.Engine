/**
 * 命令处理器域的出口。
 *
 * 执行器与运行层内部模块统一从这里取处理器；域内各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export {
  abortExtensionOp,
  execExtensionOp,
  resolveExtensionOp,
} from "./extension.ts";
export {
  execCharacter,
  execMenu,
  execNvl,
  execSay,
  execWait,
  isValidSayColor,
} from "./dialog.ts";
export { execCall, execFunc, execNavigate, execReturn } from "./call.ts";
export {
  execAssert,
  execFor,
  execForeach,
  execGuard,
  execIf,
  execSwitch,
  execWhile,
} from "./flow.ts";
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
} from "./variables.ts";
export { execAudio, execNotify, execVideo } from "./media.ts";
export {
  execAnimate,
  execElementVisual,
  execScreenEffect,
  execTextTypewriter,
  execWindow,
  runElementOps,
} from "./element/index.ts";
export {
  execAutoSaveOp,
  execLoadOp,
  execSaveDeleteOp,
  execSaveOp,
} from "./save.ts";
export {
  abortInteraction,
  execInput,
  execInteraction,
  resolveInteraction,
} from "./interaction.ts";
export { abortMinigame, execMinigame, resolveMinigame } from "./minigame.ts";
