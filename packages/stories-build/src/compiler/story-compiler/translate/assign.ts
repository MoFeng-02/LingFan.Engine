import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { diag, lookupScope, declareLocal } from "./shared";
import type { BodyCtx } from "./shared";
import { statePath } from "./expr-core";
import { lowerValue, loweredToScriptValue } from "./expr";
import { callWord } from "./words";

function assignmentTarget(ctx: BodyCtx, expr: ts.Expression): { kind: "local"; name: string } | { kind: "state"; path: string } | undefined {
  if (ts.isIdentifier(expr)) {
    if (expr.text === ctx.shared.stateRoot) {
      diag(ctx, expr, `${ctx.shared.stateRoot} 必须以成员路径使用：${ctx.shared.stateRoot}.gold`);
      return undefined;
    }
    const scoped = lookupScope(ctx, expr.text);
    if (scoped === undefined || (scoped.kind !== "let" && scoped.kind !== "param")) {
      diag(ctx, expr, `赋值目标 \`${expr.text}\` 必须是已声明的 let 局部变量`);
      return undefined;
    }
    return { kind: "local", name: expr.text };
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const path = statePath(ctx, expr);
    if (path === undefined) return undefined;
    return { kind: "state", path };
  }
  diag(ctx, expr, `赋值目标只能是 let 局部变量或 ${ctx.shared.stateRoot} 单层路径`);
  return undefined;
}

function compoundValue(ctx: BodyCtx, node: ts.Node, op: string, rhs: ts.Expression): string | undefined {
  const lowered = lowerValue(ctx, rhs);
  if (lowered === undefined) return undefined;
  if (lowered.kind === "lit" && typeof lowered.value !== "number") {
    diag(ctx, node, "复合赋值右侧必须是数值");
    return undefined;
  }
  const rhsText = lowered.kind === "lit" ? String(lowered.value) : lowered.text;
  return `${op} {${rhsText}}`;
}

export function emitAssignment(ctx: BodyCtx, node: ts.Node, target: ts.Expression, op: string, rhs: ts.Expression): StoryCommand[] {
  const resolved = assignmentTarget(ctx, target);
  if (resolved === undefined) return [];
  const word = resolved.kind === "state" ? "set" : "letVar";
  const key = resolved.kind === "state" ? resolved.path : resolved.name;
  let value: string | number | boolean;
  if (op === "=") {
    const lowered = lowerValue(ctx, rhs);
    if (lowered === undefined) return [];
    value = loweredToScriptValue(lowered);
  } else {
    const compound = compoundValue(ctx, node, op, rhs);
    if (compound === undefined) return [];
    value = compound;
  }
  const op2 = callWord(ctx, node, word, [key, value]);
  return op2 === undefined ? [] : [op2];
}

export function translateIncrement(ctx: BodyCtx, expr: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression): StoryCommand[] {
  const op = expr.operator === ts.SyntaxKind.PlusPlusToken ? "+=" : expr.operator === ts.SyntaxKind.MinusMinusToken ? "-=" : undefined;
  if (op === undefined) {
    diag(ctx, expr, "自增/自减只支持 ++ 与 --");
    return [];
  }
  return emitAssignment(ctx, expr, expr.operand, op, ts.factory.createNumericLiteral("1"));
}

// —— 语句转译 ——

export function translateVariableStatement(ctx: BodyCtx, stmt: ts.VariableStatement): StoryCommand[] {
  const out: StoryCommand[] = [];
  for (const decl of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) {
      diag(ctx, decl, "解构声明不支持：数组请用 newArray 词、对象请用 dict 词");
      continue;
    }
    if (decl.initializer === undefined) {
      diag(ctx, decl, "局部变量声明必须带初始化（引擎没有未初始化的槽位）");
      continue;
    }
    if (ts.isArrayLiteralExpression(decl.initializer)) {
      diag(ctx, decl.initializer, "数组字面量不支持：请用 newArray 词");
      continue;
    }
    if (ts.isObjectLiteralExpression(decl.initializer)) {
      diag(ctx, decl.initializer, "对象字面量不支持：请用 dict 词");
      continue;
    }
    const lowered = lowerValue(ctx, decl.initializer);
    if (lowered === undefined) continue;
    declareLocal(ctx, decl.name.text, { kind: "let" });
    const op = callWord(ctx, decl, "letVar", [decl.name.text, loweredToScriptValue(lowered)]);
    if (op !== undefined) out.push(op);
  }
  return out;
}
