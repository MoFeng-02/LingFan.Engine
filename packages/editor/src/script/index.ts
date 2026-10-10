/**
 * Script 词汇层 · 出口（全量 64 op 覆盖 + 复合词 + 表达式句柄）。
 *
 * **SCRIPT_COVERAGE = builder ↔ op 双射的机器可读面**（互锁守卫的数据源）：
 * 新增 builder 必须登记（遗漏 = 全集互锁测试红）；builder 产出未知 op 名 = 同红。
 * `$` 前缀 = 辅助词（不直接产出独立 op）——互锁比较时跳过。
 */
export const SCRIPT_COVERAGE: Readonly<Record<string, string>> = {
  // 叙事
  say: "say",
  option: "$menu.option",
  menu: "menu",
  input: "input",
  notify: "notify",
  nvl: "nvl",
  character: "character",
  // 流程
  wait: "wait",
  pause: "pause",
  random: "random",
  jump: "jump",
  navigate: "navigate",
  func: "func",
  call: "call",
  ret: "return",
  when: "if",
  whileDo: "while",
  forIn: "for",
  forEach: "foreach",
  switchOn: "switch",
  breakLoop: "break",
  continueLoop: "continue",
  whenChain: "$if.chain",
  assert: "assert",
  guard: "guard",
  // 变量
  set: "set",
  define: "define",
  letVar: "let",
  localVar: "local",
  undef: "undef",
  newArray: "array",
  arrayPush: "array_push",
  arrayPop: "array_pop",
  dict: "dict",
  dictSet: "dict_set",
  // 存档
  save: "save",
  load: "load",
  autoSave: "auto_save",
  saveDelete: "save_delete",
  // 音频
  bgm: "bgm",
  stopBgm: "stop_bgm",
  se: "se",
  ambient: "ambient",
  stopAmbient: "stop_ambient",
  voice: "voice",
  stopVoice: "stop_voice",
  // 视频
  video: "video",
  cutscene: "cutscene",
  seekVideo: "seek_video",
  pauseVideo: "pause_video",
  resumeVideo: "resume_video",
  stopVideo: "stop_video",
  videoSkipable: "video_skipable",
  // 小游戏
  minigame: "minigame",
  reward: "$minigame.reward",
  // 外部玩法系统接管
  interaction: "interaction",
  // 元素
  show: "show",
  hide: "hide",
  background: "background",
  bgSwitch: "bg_switch",
  setZ: "zindex",
  style: "style",
  dialogWindow: "window",
  animate: "animate",
  animateBlock: "animate_block",
  transition: "transition",
  shake: "shake",
  textTypewriter: "text_typewriter",
  // 扩展（通用出口：产出任意 op 名——互锁比较时跳过；白名单归构建期声明与运行期注册）
  extOp: "$ext.op",
  // 复合词（辅助词：纯展开，不产新语义）
  sceneSetup: "$composite.scene",
  buttonElement: "$composite.button",
  textElement: "$composite.text",
  imageElement: "$composite.image",
  sceneType: "$column.type",
};

// —— 类型（裸写命令的强类型形态：op 判别联合，与 OP_SCHEMA_MAP / validateCommand 同源）——
// 裸对象 `const cmd: ScriptCommand = { op: "say", text, z }` ⇒ op 决定字段、未知字段编译期红；
// 扩展 op 不在联合内（闭合防逃生舱漏洞）——走 `extOp()` 或显式 `: StoryCommand` 注解。
export type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
  ScriptValue,
} from "../schema";

// —— 表达式句柄 ——
export {
  defineVars,
  expr,
  cond,
  drainExpressionWarnings,
  type VarKind,
  type VarHandle,
  type VarTree,
  type ExpressionWarning,
} from "./expr";

// —— 具名实现槽位（build-time 声明词）——
export {
  cell,
  type CellHandle,
  type GuardNameRegistry,
  type KnownGuardName,
} from "./words";

// —— 叙事 ——
export { say, option, menu, input, notify, nvl, character } from "./words";
export type {
  MenuOption,
  SayOptions,
  NotifyOptions,
  NvlMode,
  CharacterOptions,
} from "./words";

// —— 流程 ——
export {
  type Stmt,
  wait,
  pause,
  random,
  jump,
  navigate,
  func,
  call,
  ret,
  when,
  whenChain,
  whileDo,
  forIn,
  forEach,
  switchOn,
  breakLoop,
  continueLoop,
  assert,
  guard,
} from "./words";

// —— 变量 ——
export {
  set,
  define,
  letVar,
  localVar,
  undef,
  newArray,
  arrayPush,
  arrayPop,
  dict,
  dictSet,
} from "./words";

// —— 存档 / 音频 / 视频 / 小游戏 ——
export { save, load, autoSave, saveDelete } from "./words";
export {
  bgm,
  stopBgm,
  se,
  ambient,
  stopAmbient,
  voice,
  stopVoice,
} from "./words";
export type {
  PlayOptions,
  BgmOptions,
  StopOptions,
  VoiceOptions,
} from "./words";
export {
  video,
  cutscene,
  seekVideo,
  pauseVideo,
  resumeVideo,
  stopVideo,
  videoSkipable,
} from "./words";
export type { VideoOptions, CutsceneOptions } from "./words";
export { minigame, reward } from "./words";
export type { MinigameOptions } from "./words";
export { interaction } from "./words";
export type { InteractionOptions } from "./words";

// —— 扩展 ——
export { extOp } from "./words";

// —— 元素 ——
export {
  show,
  hide,
  background,
  bgSwitch,
  setZ,
  style,
  dialogWindow,
  animate,
  animateBlock,
  transition,
  shake,
  textTypewriter,
} from "./words";
export type {
  ShowOptions,
  AnimateOptions,
  AnimateBlockOptions,
  ShakeOptions,
  TypewriterOptions,
  DialogWindowMode,
} from "./words";

// —— 复合词 ——
export {
  sceneSetup,
  buttonElement,
  textElement,
  imageElement,
  sceneType,
} from "./words";
export type { ElementOptions } from "./words";
