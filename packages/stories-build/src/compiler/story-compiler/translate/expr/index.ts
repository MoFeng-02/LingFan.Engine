/**
 * 表达式与赋值族出口：把 TS 表达式 / 赋值语句降成引擎命令与脚本值。
 *
 * 轴 = 值层四件——条件与取值降级（`expr.ts`）、表达式核心（`expr-core.ts`）、
 * 词表调用与命令发射（`words.ts`）、赋值与自增（`assign.ts`）。
 */
export {
  emitAssignment,
  translateIncrement,
  translateVariableStatement,
} from "./assign.ts";
export { lowerCond, loweredToScriptValue, lowerValue } from "./expr.ts";
export type { Lowered } from "./expr.ts";
export {
  engineValueText,
  lowerExpr,
  probeExpression,
  quoteEngineString,
  statePath,
} from "./expr-core.ts";
export type { StatePath } from "./expr-core.ts";
export {
  callWord,
  emitCallCommand,
  emitCommand,
  resolveFunctionCallee,
} from "./words.ts";
