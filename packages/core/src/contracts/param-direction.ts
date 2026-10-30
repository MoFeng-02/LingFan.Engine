/**
 * 参数方向档位：谁能写某个状态键。
 *
 * **为什么需要这张表**：状态键一律是「一个键 + 一个值」，看不出「宿主能不能改它」。
 * 结果是「宿主可写」靠口头约定维持——新加一个键时没人知道该不该给写权限，
 * 而给错了不是小事：`__waiting` 若能写，宿主就能伪造等待态绕过等待状态机；
 * `__audio_*` 若能直写，就绕过了音量偏好乘算。
 *
 * **本表只声明，不实现**。写路径仍归各域既有接缝（`GameStateWriter` / `setVolume` / 命令面）；
 * 物理闸仍是 `RESERVED_STATE_KEYS`（保留键一律拒直写）。表的作用是让「谁该能写」
 * 可查、可测、可守——测试据此断言「声明与能力一致」。
 *
 * **缺省只读**（fail-closed）：表里没有的键一律 `readonly`。新键默认不给写权限，
 * 要开放必须显式登记——与「白名单优于黑名单」同一条纪律。
 */
import { SYS } from "./runtime/state-keys.ts";

/**
 * 方向档位：
 * - `readonly`：引擎独占。宿主读得到，写不生效（直写命中保留键即 fail-closed）
 * - `write`：单向。宿主可写，引擎不主动改（如外部玩法系统状态）
 * - `two-way`：双向。引擎写、宿主也可写，冲突按各域既有优先级解析
 */
export type ParamDirection = "readonly" | "write" | "two-way";

/**
 * 键 → 档位。
 *
 * 键可以是**精确系统键**（`__waiting`）、**命名空间前缀**（`game.` / `preferences.`）。
 * 查表走 `runtime/paramDirection.ts` 的 `directionOf`：精确键优先，其次最长前缀，都不命中即 `readonly`。
 *
 * 登记纪律：声明为 `two-way` 的系统键**必须有一条专用接缝**（否则声明与实际能力脱节，
 * 由测试 `param-direction` 锁住）；新增 `SYS` 键时若忘登记，测试会报「未声明方向的系统键」。
 *
 * **查表函数不在本文件**：契约层只放类型与数据（本层出现函数声明即违约，
 * 由 `tests/engine/runtime/scene-type.test.ts` 锁住），实现落在 `runtime/paramDirection.ts`。
 */
export const PARAM_DIRECTION: Readonly<Record<string, ParamDirection>> = {
  // —— 只读：宿主读得到、写不生效（等待状态机与舞台事实归引擎）——
  [SYS.waiting]: "readonly",
  [SYS.currentSceneColumn]: "readonly",
  [SYS.menuPrompt]: "readonly",
  [SYS.menuOptions]: "readonly",
  [SYS.menuTargets]: "readonly",
  [SYS.menuSelected]: "readonly",
  [SYS.inputPrompt]: "readonly",
  [SYS.inputOptions]: "readonly",
  [SYS.currentDialogText]: "readonly",
  [SYS.currentDialogSpeaker]: "readonly",
  [SYS.currentDialogColor]: "readonly",
  [SYS.dialogFont]: "readonly",
  [SYS.dialogTemplate]: "readonly",
  [SYS.dialogComplete]: "readonly",
  [SYS.dialogClickable]: "readonly",
  [SYS.dialogNoskip]: "readonly",
  [SYS.dialogVisible]: "readonly",
  [SYS.elements]: "readonly",
  [SYS.animations]: "readonly",
  [SYS.transition]: "readonly",
  [SYS.shake]: "readonly",
  [SYS.video]: "readonly",
  [SYS.videoSkipable]: "readonly",
  [SYS.nvlMode]: "readonly",
  [SYS.nvlBuffer]: "readonly",
  [SYS.rollbackActive]: "readonly",
  [SYS.currentLanguage]: "readonly",
  [SYS.autoSave]: "readonly",
  [SYS.menuReturn]: "readonly",
  [SYS.minigame]: "readonly",
  [SYS.interaction]: "readonly",
  [SYS.typewriter]: "readonly",
  /** 实例级 z：命令写、宿主按它解析后下发（宿主不改这个值本身） */
  [SYS.dialogueZ]: "readonly",
  [SYS.choicesZ]: "readonly",
  [SYS.notificationsZ]: "readonly",
  [SYS.minigameZ]: "readonly",
  [SYS.interactionZ]: "readonly",
  [SYS.videoZ]: "readonly",

  // —— 单向：宿主写，引擎不主动改 ——
  /** 外部玩法系统 / 扩展的状态命名空间（写入经 `GameStateWriter` / `ExtensionContext`） */
  "game.": "write",
  "ext.": "write",

  // —— 双向：引擎写、宿主可写（各有专用接缝）——
  /** 玩家偏好：引擎读、宿主写（`PlayerPreferences.setVolume` 等），变化触发渲染层重规划 */
  "preferences.": "two-way",
  /** 音频四通道：命令写状态、偏好层再乘算；专用接缝 = 命令面 + `PlayerPreferences` */
  [SYS.audioBgm]: "two-way",
  [SYS.audioSe]: "two-way",
  [SYS.audioAmbient]: "two-way",
  [SYS.audioVoice]: "two-way",
  /** 音频实例表：命令写、宿主可按 id 改音量；专用接缝 = 实例命令面 */
  [SYS.audioInstances]: "two-way",
  /** 背景乐播放位置：引擎回写、宿主可定位（读档后对齐） */
  [SYS.bgmPosition]: "two-way",
  /** 挂载 UI 表：命令写显隐与入参、宿主读后挂载/卸载组件；专用接缝 = `mount` op */
  [SYS.mounts]: "two-way",
};
