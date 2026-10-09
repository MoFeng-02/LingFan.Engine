/**
 * 表达式域的出口：值模型、词法、解析求值、内建函数、文本插值。
 *
 * 域内各文件之间按需直接引用；这里只做转发，不放任何实现。
 */
export {
  ExpressionError,
  exprEquals,
  type ExprDict,
  type ExpressionErrorCode,
  type ExprValue,
} from "./value";
export { evaluateExpression } from "./evaluate";
export { interpolateText, type TextInterpolation } from "./interpolate";
export type { NameResolver } from "../resolver";
