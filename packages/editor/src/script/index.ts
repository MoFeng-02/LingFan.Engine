/**
 * Script 词汇层 · 出口（全量 op 覆盖 + 复合词 + 表达式句柄）。
 *
 * **SCRIPT_COVERAGE = builder ↔ op 双射的机器可读面**——生成物（./vocabulary.g.ts，
 * 由 generate-vocabulary.ts 重建，勿手改）：直接词条来自 words 源返回注解扫描，
 * 辅助词走显式补充表，注册表键集快照同步入内。改注册表/词条后未重建 =
 * tests/editor/script-vocabulary.test.ts 的生成物新鲜度用例红。
 * `$` 前缀 = 辅助词（不直接产出独立 op）——互锁比较时跳过。
 */
export {
  SCRIPT_COVERAGE,
  VOCABULARY_OPS,
  type VocabularyOp,
} from "./vocabulary.g.ts";

// —— 类型（裸写命令的强类型形态：op 判别联合，与 OP_SCHEMA_MAP / validateCommand 同源）——
// 裸对象 `const cmd: ScriptCommand = { op: "say", text, z }` ⇒ op 决定字段、未知字段编译期红；
// 扩展 op 不在联合内（闭合防逃生舱漏洞）——走 `extOp()` 或显式 `: StoryCommand` 注解。
export type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
  ScriptValue,
} from "../schema/index.ts";

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
} from "./expr/index.ts";

// —— 编译期构造（仅 Stories.src 源内可用，运行期不提供实现）——
export { staticFor } from "./words/index.ts";
export type { StoryFn } from "./words/index.ts";

// —— 具名实现槽位（build-time 声明词）——
export {
  cell,
  type CellHandle,
  type ColumnNameRegistry,
  type GuardNameRegistry,
  type InterpolationKeyRegistry,
  type KnownColumnName,
  type KnownGuardName,
  type KnownInterpolationKey,
} from "./words/index.ts";

// —— 叙事 ——
export {
  say,
  option,
  menu,
  input,
  inputCandidate,
  notify,
  nvl,
  character,
  uncharacter,
} from "./words/index.ts";
export type {
  MenuOptionSpec,
  InputCandidateSpec,
  SayOptions,
  NotifyOptions,
  NvlCommandMode,
  CharacterOptions,
} from "./words/index.ts";

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
} from "./words/index.ts";

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
} from "./words/index.ts";

// —— 存档 / 音频 / 视频 / 小游戏 ——
export { save, load, autoSave, saveDelete } from "./words/index.ts";
export {
  bgm,
  stopBgm,
  se,
  ambient,
  stopAmbient,
  voice,
  stopVoice,
} from "./words/index.ts";
export type {
  PlayOptions,
  BgmOptions,
  StopOptions,
  VoiceOptions,
} from "./words/index.ts";
export {
  video,
  cutscene,
  seekVideo,
  pauseVideo,
  resumeVideo,
  stopVideo,
  videoSkipable,
} from "./words/index.ts";
export type { VideoOptions, CutsceneOptions } from "./words/index.ts";
export { minigame, reward } from "./words/index.ts";
export type { MinigameOptions } from "./words/index.ts";
export { interaction } from "./words/index.ts";
export type { InteractionOptions } from "./words/index.ts";

// —— 扩展 ——
export { extOp } from "./words/index.ts";

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
} from "./words/index.ts";
export type {
  ShowOptions,
  AnimateOptions,
  AnimateBlockOptions,
  ShakeOptions,
  TypewriterOptions,
  DialogWindowMode,
} from "./words/index.ts";

// —— 复合词 ——
export {
  sceneSetup,
  buttonElement,
  textElement,
  imageElement,
  sceneType,
} from "./words/index.ts";
export type { ElementOptions } from "./words/index.ts";
