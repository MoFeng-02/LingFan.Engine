/**
 * 条件求值与确定性随机：解释执行与表达式层之间的桥。
 * 随机数状态进快照，重放序列必然一致。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { evaluateExpression, ExpressionError } from "../expr";
import type { OpContext } from "./context";

/**
 * 条件求值：`{...}` 包裹按约定剥离，结果必须是 boolean。
 * 任何失败都出站错误并返回 null（调用方停机），非字符串输入同样 fail-closed。
 */
export function evalCond(ctx: OpContext, src: unknown): boolean | null {
  if (typeof src !== "string") {
    ctx.fail("eval-type-error", "条件必须为字符串表达式");
    return null;
  }
  const t = src.trim();
  const inner = t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
  try {
    const v = evaluateExpression(inner, ctx.resolveName, () => ctx.draw());
    if (typeof v !== "boolean") {
      ctx.fail("eval-type-error", `条件必须为 boolean，收到 ${typeof v}`);
      return null;
    }
    return v;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return null;
    }
    throw e;
  }
}

/** mulberry32 确定性随机 [0,1)：随机数状态进快照，回溯重放序列必然一致 */
export function draw(ctx: OpContext): number {
  ctx.rngState = (ctx.rngState + 0x6d2b79f5) | 0;
  let t = ctx.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
