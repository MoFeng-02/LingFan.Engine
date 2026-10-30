/**
 * 宿主屏幕：此刻该渲染哪一屏。
 *
 * 引擎不认识「启动界面」，它只知道**当前列 id** 与**当前列类型**（归一后的
 * `game` / `ui`）。所以「启动界面 ⇄ 游戏渲染」的切换判据只能由宿主从这两样东西
 * 推出来，本文件是那个推导的**唯一一处**——Vue / React / 原生 DOM 三种形态都调它，
 * 谁都不许各写一份 `if`，否则三形态会在边界情形上分叉（最典型的是启动首帧）。
 *
 * 判据有两条，缺一条就出真机故障：
 * 1. **列 id 为空串 ⇒ 启动界面**。`engine.start()` 之前 `currentColumnId()` 是空串，
 *    而 `currentColumnType()` 在找不到列时缺省返回 `game`（`sceneTypeOf({})`）。
 *    只看类型会把启动首帧判成游戏屏，症状是「黑一帧再跳回启动界面」。
 * 2. **类型不是 `game` ⇒ 启动界面**。`ui` 列是界面层（标题 / 设置 / 覆盖层），
 *    它的内容不是游戏渲染，该由普通 App 界面承担。
 *
 * 反过来说：只有「引擎已经在某个 `game` 列上」这一种情形才渲染游戏屏。
 */

/** 宿主屏幕：普通 App 界面 / 游戏渲染 */
export type HostScreen = "start" | "game";

/** 推导输入：引擎读口给出的当前列两件事实 */
export interface HostScreenInput {
  /** 当前列 id；引擎尚未跑起来时是空串 */
  readonly columnId: string;
  /** 当前列类型（已归一：`game` / `ui`）；列 id 失效时读口给 `game` */
  readonly columnType: string;
}

/**
 * 推导此刻该渲染哪一屏。
 *
 * @param input 当前列 id 与归一后的类型。
 * @returns `"start"` 或 `"game"`。
 * @example
 * hostScreenOf({ columnId: "", columnType: "game" });        // "start"（首帧）
 * hostScreenOf({ columnId: "title_main", columnType: "ui" }); // "start"
 * hostScreenOf({ columnId: "chapter1", columnType: "game" }); // "game"
 */
export function hostScreenOf(input: HostScreenInput): HostScreen {
  if (input.columnId === "") return "start";
  return input.columnType === "game" ? "game" : "start";
}
