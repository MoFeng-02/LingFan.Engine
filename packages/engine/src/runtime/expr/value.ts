/**
 * 表达式的值模型：动态类型值域、错误类型与相等规则。
 *
 * 求值时机 = 执行期；fail-closed：类型错误、未知变量/函数、除零 →
 * ExpressionError（不静默 NaN）。
 */

/** 值域：number / boolean / string / 数组 / 字典（interface 落点支持递归） */
export interface ExprDict {
  [key: string]: ExprValue;
}

export type ExprValue = number | boolean | string | ExprValue[] | ExprDict;

export type ExpressionErrorCode =
  | "parse-error"
  | "non-chained-comparison"
  | "type-error"
  | "unknown-variable"
  | "unknown-function"
  | "arity-error"
  | "invalid-range"
  | "division-by-zero";

export class ExpressionError extends Error {
  constructor(
    readonly code: ExpressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

/** ==/!= 的类型规则（switch 复用）：仅同类型标量比较，否则 type-error */
export function exprEquals(a: ExprValue, b: ExprValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  throw new ExpressionError(
    "type-error",
    `'=='/'!=' 不支持跨类型或复合类型比较（${typeof a} vs ${typeof b}）`,
  );
}
