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

/**
 * 表达式运行期的值域：标量（number/boolean/string）或数组/字典复合值。
 * 复合值只由 array/dict 系列 op 产出；文本插值遇到复合值直接报错，不做隐式字符串化。
 */
export type ExprValue = number | boolean | string | ExprValue[] | ExprDict;

/** 表达式错误的稳定分类；上层按码分流（如落成失败码），message 只作展示 */
export type ExpressionErrorCode =
  | "parse-error"
  | "non-chained-comparison"
  | "type-error"
  | "unknown-variable"
  | "unknown-function"
  | "arity-error"
  | "invalid-range"
  | "division-by-zero";

/**
 * 表达式解析/求值错误：code 给程序判定，message 给作者看。
 * name 固定为 "ExpressionError"，便于跨模块按字符串识别。
 */
export class ExpressionError extends Error {
  /** @param code 稳定错误分类；@param message 面向作者的说明 */
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
