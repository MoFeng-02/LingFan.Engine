/**
 * 求值入口：解析 + 求值一步完成（求值时机 = 执行到它的时刻）。
 */
import type { NameResolver } from "../resolver";
import { tokenize } from "./lexer";
import { Parser } from "./parser";
import { ExpressionError, type ExprValue } from "./value";

/** rng 缺省 Math.random（引擎注入确定性 rng） */
export function evaluateExpression(
  src: string,
  resolve: NameResolver,
  rng: () => number = Math.random,
): ExprValue {
  const tokens = tokenize(src);
  if (tokens[0]?.kind === "eof")
    throw new ExpressionError("parse-error", "表达式为空");
  return new Parser(tokens, resolve, rng).parse()();
}
