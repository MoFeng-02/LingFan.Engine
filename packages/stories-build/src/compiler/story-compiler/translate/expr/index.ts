/**
 * 表达式与赋值族出口：把 TS 表达式 / 赋值语句降成引擎命令与脚本值。
 *
 * 轴 = 值层四件——条件与取值降级（`expr.ts`）、表达式降级与路径归约
 * （`lower/` + `state-path.ts` + `probe.ts` + `engine-text.ts`）、
 * 词表调用与命令发射（`words.ts`）、赋值与自增（`assign.ts`）。
 */
export {
  emitAssignment,
  translateIncrement,
  translateVariableStatement,
} from "./assign.ts";
export { lowerCond, loweredToScriptValue, lowerValue } from "./expr.ts";
export type { Lowered } from "./expr.ts";
export { engineValueText, quoteEngineString } from "./engine-text.ts";
export { lowerExpr } from "./lower/index.ts";
export { probeExpression } from "./probe.ts";
export { statePath } from "./state-path.ts";
export type { StatePath } from "./state-path.ts";
export {
  callWord,
  emitCallCommand,
  emitCommand,
  resolveFunctionCallee,
} from "./words.ts";
