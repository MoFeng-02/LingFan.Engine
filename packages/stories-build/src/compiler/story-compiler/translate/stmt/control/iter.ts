import * as ts from "typescript";
import type { StoryCommand } from "@lingfan-engine/core";
import { diag, lookupScope } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import { statePath } from "../../expr/state-path.ts";
import { callWord } from "../../expr/words/index.ts";
import { translateBlockBody } from "../control-flow.ts";
import type { StatementDispatch } from "../control-flow.ts";

export function translateForOf(
  ctx: BodyCtx,
  stmt: ts.ForOfStatement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  const initializer = stmt.initializer;
  if (
    !ts.isVariableDeclarationList(initializer) ||
    initializer.declarations.length !== 1 ||
    !ts.isIdentifier(initializer.declarations[0].name)
  ) {
    diag(ctx, initializer, "for-of 只支持 (let x of 集合) 形式");
    return [];
  }
  const varName = initializer.declarations[0].name.text;
  const collection = forOfCollection(ctx, stmt.expression);
  if (collection === undefined) return [];
  ctx.scopes.push(new Map([[varName, { kind: "let" }]]));
  ctx.breakables.push("loop");
  const body = translateBlockBody(ctx, stmt.statement, dispatch);
  ctx.breakables.pop();
  ctx.scopes.pop();
  const op = callWord(ctx, stmt, "forIn", [varName, collection, body]);
  return op === undefined ? [] : [op];
}

function forOfCollection(
  ctx: BodyCtx,
  expr: ts.Expression,
): string | undefined {
  const root = ctx.shared.stateRoot;
  if (ts.isIdentifier(expr)) {
    if (expr.text === root) {
      diag(ctx, expr, `for-of 集合必须是 ${root} 路径或局部变量名`);
      return undefined;
    }
    const scoped = lookupScope(ctx, expr.text);
    if (
      scoped !== undefined &&
      (scoped.kind === "let" || scoped.kind === "param")
    ) {
      return `{${expr.text}}`;
    }
    diag(
      ctx,
      expr,
      `for-of 集合 \`${expr.text}\` 必须是已声明的局部变量或 ${root} 路径`,
    );
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const target = statePath(ctx, expr);
    if (target === undefined) return undefined;
    if (target.optional) {
      // 迭代集合必须真实存在（缺失语义无从谈起），fail-closed
      diag(ctx, expr, `for-of 集合不支持可选链：${target.path}`);
      return undefined;
    }
    return `{${target.path}}`;
  }
  diag(ctx, expr, `for-of 集合只能是 ${root} 路径或局部变量名`);
  return undefined;
}
