/**
 * 列身体组件名的形态：名字 = `src/scenes/<名>/` 的目录名。
 *
 * 与 `UI_NAME_PATTERN` 指向同一个短标识形态，理由也相同：名字同时是**产物里的字符串**、
 * 宿主的**查表键**、以及目录/文件名的来源。不卡形态的话，`Kitchen` 与 `kitchen` 会在
 * 不同文件系统上落到同一个目录、却成为两个不同的产物键，产物与实现就对不上了。
 *
 * 形态与扩展 id / 玩法系统 id / UI 名同源（`SHORT_ID_PATTERN`）：同一个系统不出现两种写法。
 */
import { SHORT_ID_PATTERN } from "../contracts/identifiers.ts";
import { compareOrdinal } from "./ordering.ts";

/** 合法组件名：小写字母开头，其后小写字母 / 数字 / `_` / `-`，总长 1..32 */
export const SCENE_NAME_PATTERN = SHORT_ID_PATTERN;

/** 是否为合法组件名（类型收窄到 `string`，可直接用于过滤未校验的 JSON） */
export function isSceneName(value: unknown): value is string {
  return typeof value === "string" && SCENE_NAME_PATTERN.test(value);
}

/**
 * 归一组件名列表：**去重 + 按名字码点序**。
 *
 * 为什么不复用 `normalizeUiNames`：两者形态相同但**语义不同**（一个是 UI 叠加层、
 * 一个是列身体）。共用同一个函数会让将来某一侧要放宽形态时被迫连另一侧一起改。
 * 排序共用 `compareOrdinal`，定序口径仍然只有一份。
 */
export function normalizeSceneNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  unique.sort(compareOrdinal);
  return unique;
}
