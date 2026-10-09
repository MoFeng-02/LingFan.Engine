/**
 * 表达式求值与名称解析。
 */
import { ExpressionError, evaluateExpression, type ExprValue } from "../expr";
import type { OpContext } from "../internal";

/**
 * set/define 负载值（表达式一律 {} 包裹，字符串原样即字面量）：
 * - "{expr}" → 表达式求值；number/boolean（JSON 原生）→ 字面量；其余字符串 → 字符串字面量
 */
export function evalValue(ctx: OpContext, raw: unknown): ExprValue {
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  if (typeof raw !== "string") {
    throw new ExpressionError("type-error", `不支持的值类型：${typeof raw}`);
  }
  const t = raw.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    return evaluateExpression(t.slice(1, -1), ctx.resolveName, () =>
      ctx.draw(),
    );
  }
  return raw;
}

/** 按名读变量：走作用域链解析，未定义时抛错（调用方决定是否转为 fail-closed） */
export function readVariable(ctx: OpContext, key: string): ExprValue {
  const hit = ctx.resolveName(key);
  if (!hit.found)
    throw new ExpressionError("unknown-variable", `未定义变量：${key}`);
  return hit.value as ExprValue;
}

/**
 * 名称解析（作用域链查找语义）：
 * 块/列作用域链 → 全局扁平键；点路径再走「扁平优先 → 字典逐层下钻」。
 */
export function resolveName(
ctx: OpContext,
name: string,
): {
  found: true; value: unknown } | { found: false } {
  const scope = ctx.frames[ctx.frames.length - 1]?.scope;
  if (scope !== undefined) {
    const hit = scope.lookup(name);
    if (hit.found) return hit;
  }
  if (ctx.state.has(name))
    return { found: true, value: ctx.state.get(name) };
  if (name.includes(".")) {
    const parts = name.split(".");
    let cur: unknown;
    if (scope !== undefined) {
      const head = scope.lookup(parts[0]!);
      if (head.found) cur = head.value;
    }
    if (cur === undefined) {
      if (!ctx.state.has(parts[0]!)) return { found: false };
      cur = ctx.state.get(parts[0]!);
    }
    for (const seg of parts.slice(1)) {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur))
        return { found: false };
      const rec = cur as Record<string, unknown>;
      if (!(seg in rec)) return { found: false };
      cur = rec[seg];
    }
    return { found: true, value: cur };
  }
  return { found: false };
}
