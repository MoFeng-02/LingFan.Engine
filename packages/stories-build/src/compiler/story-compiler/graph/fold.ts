import * as ts from "typescript";
import type { Binding, ConstValue, DiagBag, JsonValue } from "./core.ts";

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
    // 组件句柄在编译期就是一个名字：`export const picked = hub` 折成 `"hub"`，
    // 于是 `mount(picked, true)` 与 `mount(hub, true)` 的产物完全一致；列身体同理
    // （`export const body = kitchen` 指向 `scenes/kitchen/`）。
    if (b?.kind === "ui" || b?.kind === "scene") return b.name;
    return b?.kind === "const" ? b.value : undefined;
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const b = lookup(expr.expression.text);
    if (b?.kind === "enum") return b.members.get(expr.name.text);
    return undefined;
  }
  return undefined;
}

/**
 * 静态折叠一个 JSON 安全值：字符串/数字/布尔/null/数组/对象字面量。
 *
 * 与 `foldConst` 的分工：那个收口「一个标量」，这个收口「一棵静态值树」——列身体
 * 的 props 要整块进 `SYS.body`，运行期不求值，所以构建期必须能把它读成纯数据。
 * 任何需要运行期才能定的写法（标识符、调用、展开、计算属性）都返回 `undefined`，
 * 由调用方报错；这里不自作聪明地接受一部分。
 */
export function foldJsonValue(expr: ts.Expression): JsonValue | undefined {
  if (ts.isParenthesizedExpression(expr)) return foldJsonValue(expr.expression);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
    return expr.text;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const items: JsonValue[] = [];
    for (const element of expr.elements) {
      const value = foldJsonValue(element);
      if (value === undefined) return undefined;
      items.push(value);
    }
    return items;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const object: { [key: string]: JsonValue } = {};
    for (const property of expr.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = propertyName(property.name);
      if (key === undefined) return undefined;
      const value = foldJsonValue(property.initializer);
      if (value === undefined) return undefined;
      object[key] = value;
    }
    return object;
  }
  return undefined;
}

/** 对象字面量的键：只认标识符、字符串与数字字面量（计算键要运行期求值） */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
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
