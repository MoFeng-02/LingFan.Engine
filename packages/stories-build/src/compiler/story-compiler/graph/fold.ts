import * as ts from "typescript";
import type { Binding, ConstValue, DiagBag } from "./core.ts";

function foldNumeric(
  op: string,
  left: number,
  right: number,
): number | undefined {
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? undefined : left / right;
    case "%":
      return right === 0 ? undefined : left % right;
    default:
      return undefined;
  }
}

export function foldConst(
  expr: ts.Expression,
  sf: ts.SourceFile,
  diags: DiagBag,
  file: string,
  lookup: (name: string) => Binding | undefined,
): ConstValue | undefined {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
    return expr.text;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isParenthesizedExpression(expr)) {
    return foldConst(expr.expression, sf, diags, file, lookup);
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken
  ) {
    const v = foldConst(expr.operand, sf, diags, file, lookup);
    return typeof v === "number" ? -v : undefined;
  }
  if (ts.isTemplateExpression(expr)) {
    const parts: string[] = [expr.head.text];
    for (const span of expr.templateSpans) {
      const v = foldConst(span.expression, sf, diags, file, lookup);
      if (v === undefined) return undefined;
      parts.push(String(v), span.literal.text);
    }
    return parts.join("");
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.getText(sf);
    const left = foldConst(expr.left, sf, diags, file, lookup);
    const right = foldConst(expr.right, sf, diags, file, lookup);
    if (left === undefined || right === undefined) return undefined;
    if (typeof left === "string" && typeof right === "string" && op === "+")
      return left + right;
    if (typeof left === "number" && typeof right === "number") {
      const n = foldNumeric(op, left, right);
      return n === undefined || Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  if (ts.isConditionalExpression(expr)) {
    const cond = foldConst(expr.condition, sf, diags, file, lookup);
    if (cond === undefined) return undefined;
    return cond
      ? foldConst(expr.whenTrue, sf, diags, file, lookup)
      : foldConst(expr.whenFalse, sf, diags, file, lookup);
  }
  if (ts.isIdentifier(expr)) {
    const b = lookup(expr.text);
    return b?.kind === "const" ? b.value : undefined;
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const b = lookup(expr.expression.text);
    if (b?.kind === "enum") return b.members.get(expr.name.text);
    return undefined;
  }
  return undefined;
}

export function scanEnum(
  node: ts.EnumDeclaration,
  sf: ts.SourceFile,
  diags: DiagBag,
  file: string,
): Map<string, ConstValue> | null {
  const members = new Map<string, ConstValue>();
  let next = 0;
  for (const m of node.members) {
    const memberName = m.name.getText(sf);
    if (m.initializer === undefined) {
      members.set(memberName, next);
      next += 1;
      continue;
    }
    const value = foldConst(m.initializer, sf, diags, file, (n) => {
      const v = members.get(n);
      return v === undefined ? undefined : { kind: "const", value: v };
    });
    if (value === undefined) {
      diags.add(
        file,
        sf,
        m,
        "枚举成员初始化仅支持字符串、数字字面量或已声明的枚举成员",
      );
      return null;
    }
    if (typeof value === "number") next = value + 1;
    members.set(memberName, value);
  }
  return members;
}
