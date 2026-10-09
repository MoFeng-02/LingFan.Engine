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

export function elements(ctx: OpContext): ElementInstance[] {
    const value = ctx.state.get(SYS.elements);
    return Array.isArray(value) ? (value as ElementInstance[]) : [];
  }

export function findElements(ctx: OpContext, target: string): ElementInstance[] {
    return findElementsIn(ctx.elements(), target);
  }

export function mapElements(ctx: OpContext, mapper: (el: ElementInstance) => ElementInstance): ElementInstance[] {
    const walk = (list: readonly ElementInstance[]): ElementInstance[] =>
      list.map((el) => {
        const mapped = mapper(el);
        if (mapped.children.length === 0) return mapped;
        return { ...mapped, children: walk(mapped.children) };
      });
    return walk(ctx.elements());
  }

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

export function getCharacter(ctx: OpContext, key: string): CharacterDef | undefined {
    return ctx.characters.get(key);
  }

export function getCharacters(ctx: OpContext): CharacterDef[] {
    return [...ctx.characters.values()];
  }
