/**
 * 舞台与角色的只读接缝：元素表读取、寻址、递归映射与文本插值。
 * 元素表是纯数据，随快照、存档与回溯自动随行。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS, type CharacterDef, type ElementInstance } from "../../contracts";
import { findElements as findElementsIn } from "../../data";
import { interpolateText } from "../expr";
import type { OpContext } from "./context";

/** 当前舞台元素（只读；所有元素写入都经 `SYS.elements`，随快照、存档与回溯） */
export function elements(ctx: OpContext): ElementInstance[] {
  const value = ctx.state.get(SYS.elements);
  return Array.isArray(value) ? (value as ElementInstance[]) : [];
}

/**
 * 元素寻址：`id` 精确匹配优先，未命中再按 `name` 批量匹配（递归含 children）。
 * 未命中返回空数组——调用方 fail-closed（不静默、不伪造目标）。
 */
export function findElements(ctx: OpContext, target: string): ElementInstance[] {
  return findElementsIn(ctx.elements(), target);
}

/**
 * 元素表递归映射（含 children）。命中判定按**引用**：寻址结果与当前元素表同源同引用，
 * 故可用 `hits.includes(el)` 精确命中，无需按 id 反查，避免派生 id 重名歧义。
 */
export function mapElements(ctx: OpContext, mapper: (el: ElementInstance) => ElementInstance): ElementInstance[] {
  const walk = (list: readonly ElementInstance[]): ElementInstance[] =>
    list.map((el) => {
      const mapped = mapper(el);
      if (mapped.children.length === 0) return mapped;
      return { ...mapped, children: walk(mapped.children) };
    });
  return walk(ctx.elements());
}

/**
 * 文本插值：宿主侧文本（如元素动作的 `value`）在**点击时**求值，取最新变量。
 * 失败保留原文并出站错误（不静默吞错）；空串与非法输入直接返回空串。
 */
export function interpolate(ctx: OpContext, source: string): string {
  if (typeof source !== "string" || source === "") return "";
  const { text, errors } = interpolateText(
    source,
    ctx.resolveName,
    ctx.draw,
  );
  for (const e of errors)
    ctx.fail(e.code, `插值失败（保留原文）：${e.message}`);
  return text;
}

/** 按名取角色定义（未登记返回 undefined，调用方自行 fail-closed） */
export function getCharacter(ctx: OpContext, key: string): CharacterDef | undefined {
  return ctx.characters.get(key);
}

/** 全部已登记的角色定义（按登记顺序快照一份，调用方改动不影响内部表） */
export function getCharacters(ctx: OpContext): CharacterDef[] {
  return [...ctx.characters.values()];
}
