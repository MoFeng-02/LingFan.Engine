/**
 * 作者词汇表（构建期共享模块）。
 *
 * 本故事用 **Script 词汇层写法**（与对象字面量写法同故事、同语义）：作者词汇来自
 * `@lingfan/editor` 的 `script` 命名空间，出口收敛在本文件——say/menu/when/assert/guard
 * 一行一个，底层 StoryCommand 形状知识收敛进词汇层（编辑器包），故事源只说人话。
 *
 * 注意：这里全是**构建期**绑定——怎么用见 `story.ts` 头注的「分界」段。
 */
import { script } from "@lingfan/editor";

/** 构建期作者词汇的具名出口：全部来自 `@lingfan/editor` 的 `script` 命名空间；故事源只经本出口取词。 */
export const {
  defineVars,
  expr,
  cond,
  say,
  option,
  menu,
  input,
  notify,
  nvl,
  character,
  bgm,
  se,
  stopBgm,
  ambient,
  stopAmbient,
  voice,
  stopVoice,
  video,
  cutscene,
  seekVideo,
  pauseVideo,
  resumeVideo,
  stopVideo,
  videoSkipable,
  set,
  letVar,
  undef,
  newArray,
  arrayPush,
  arrayPop,
  dict,
  dictSet,
  random,
  whileDo,
  forIn,
  forEach,
  switchOn,
  breakLoop,
  continueLoop,
  navigate,
  autoSave,
  save,
  saveDelete,
  whenChain,
  wait,
  jump,
  assert,
  guard,
  cell,
  extOp,
  sceneSetup,
  textElement,
  buttonElement,
  show,
  animate,
  animateBlock,
  style,
  setZ,
  shake,
  transition,
  hide,
  bgSwitch,
  background,
  dialogWindow,
  textTypewriter,
  minigame,
  reward,
} = script;

/** 显式变量注册：变量句柄先登记后引用——插值键有类型，拼写错在构建期暴露。 */
export const vars = defineVars({
  "player.gold": "num",
  "player.name": "str",
  n: "num",
  m: "num",
  dice: "num",
});

/** 构建期常量枚举：地点 id 的具名写法，PLACES 与菜单选项引用它；运行期不存在——产物只有展开后的数据。 */
export enum 地点 {
  酒馆 = "inn",
  广场 = "square",
  元素舞台 = "stage_demo",
  TS能力 = "ts_power",
}
