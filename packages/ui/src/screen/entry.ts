/**
 * 「进入游戏」要走到哪一列。
 *
 * 引擎只知道自己停在哪一列、那一列是什么类型（R6：它不认识「启动界面」）。
 * 所以「开始」这个动作在宿主侧必须翻译成一个具体的列 id，而**不能**写死列名：
 * 工程换了、入口列改了，写死的名字就会指到不存在的列。
 *
 * 判据只两条：入口列本身是 `game` 就直接进它；否则取**列清单里第一个 `game` 列**。
 * 两条都落空（整个工程没有 `game` 列）返回 `undefined`——调用方据此把按钮置灰，
 * 而不是让玩家点进一片空白。
 */
import type { ColumnSummary } from "@lingfan-engine/core";

/**
 * 挑出「开始」按钮该导航到的列。
 *
 * @param columns 列清单（来自 `engine.columns()`，顺序即工程里的列序）。
 * @param entry 入口列 id（来自工程清单的 `entry`）。
 * @returns 目标列 id；没有可进入的 `game` 列时返回 `undefined`。
 *
 * 入口列优先：工程可以刻意把入口做成一个 `game` 列（那就没有启动界面这一屏），
 * 这时「开始」与「继续」都在同一列上，行为与玩家的直觉一致。
 */
export function firstGameColumn(
  columns: readonly ColumnSummary[],
  entry: string,
): string | undefined {
  const entryColumn = columns.find((column) => column.id === entry);
  if (entryColumn !== undefined && entryColumn.type === "game") return entry;
  const first = columns.find((column) => column.type === "game");
  return first === undefined ? undefined : first.id;
}
