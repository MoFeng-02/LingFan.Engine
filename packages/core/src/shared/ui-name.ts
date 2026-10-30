/**
 * 列级 UI 名字的形态与定序：名字 = `src/ui/<名>/` 的目录名。
 *
 * 为什么名字要卡形态：名字同时是**产物里的字符串**、宿主的**预加载键**、以及
 * 目录/文件名的来源。不卡形态的话，`Hub` 与 `hub` 会在不同文件系统上落到同一个目录、
 * 却成为两个不同的产物键，产物与实现就对不上了。
 *
 * 形态与扩展 id / 玩法系统 id 同源（`SHORT_ID_PATTERN`）：同一个系统不出现两种写法，
 * 且名字作为产物字段时仍然短小可读。
 */
import { SHORT_ID_PATTERN } from "../contracts/identifiers.ts";
import { compareOrdinal } from "./ordering.ts";

/** 合法 UI 名：小写字母开头，其后小写字母 / 数字 / `_` / `-`，总长 1..32 */
export const UI_NAME_PATTERN = SHORT_ID_PATTERN;

/** 是否为合法 UI 名（类型收窄到 `string`，可直接用于过滤未校验的 JSON 数组） */
export function isUiName(value: unknown): value is string {
  return typeof value === "string" && UI_NAME_PATTERN.test(value);
}

/**
 * 归一列级 `uis`：**去重 + 按名字码点序**。
 *
 * 为什么必须归一：`uis` 是产物字节的一部分，而它的来源（导入语句的书写顺序、
 * 文件系统的目录枚举顺序）在不同机器上不一样。不归一的产物会「同源不同字节」，
 * 缓存与逐字节比对全部失效。码点序（而非 locale 序）才与运行环境的语言无关。
 *
 * 这是全链路唯一的定序点：解析、汇编、写出三处都调这里，不各写一份比较器。
 */
export function normalizeUiNames(names: readonly string[]): string[] {
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
