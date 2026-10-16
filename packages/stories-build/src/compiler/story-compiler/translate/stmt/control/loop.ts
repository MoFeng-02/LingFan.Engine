import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { diag, isAssignmentOperator } from "../../shared.ts";
import type { BodyCtx, Scope } from "../../shared.ts";
import {
  lowerCond,
  lowerValue,
  loweredToScriptValue,
} from "../../expr/expr.ts";
import { callWord } from "../../expr/words.ts";
import { emitAssignment, translateIncrement } from "../../expr/assign.ts";
import { translateBlockBody } from "../control-flow.ts";
import type { StatementDispatch } from "../control-flow.ts";

export function translateWhile(
  ctx: BodyCtx,
  stmt: ts.WhileStatement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  const cond = lowerCond(ctx, stmt.expression);
  if (cond === undefined) return [];
  ctx.scopes.push(new Map());
  ctx.breakables.push("loop");
  const body = translateBlockBody(ctx, stmt.statement, dispatch);
  ctx.breakables.pop();
  ctx.scopes.pop();
  const op = callWord(ctx, stmt, "whileDo", [cond, body]);
  return op === undefined ? [] : [op];
}

export function translateFor(
  ctx: BodyCtx,
  stmt: ts.ForStatement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  if (
    stmt.initializer === undefined ||
    !ts.isVariableDeclarationList(stmt.initializer)
  ) {
    diag(
      ctx,
      stmt,
      "for 初始化只支持单个带初值的 let 声明（for (let i = 0; …)）",
    );
    return [];
  }
  const decls = stmt.initializer.declarations;
  if (
    decls.length !== 1 ||
    !ts.isIdentifier(decls[0].name) ||
    decls[0].initializer === undefined
  ) {
    diag(ctx, stmt.initializer, "for 初始化只支持单个带初值的 let 声明");
    return [];
  }
  const lowered = lowerValue(ctx, decls[0].initializer);
  if (lowered === undefined) return [];
  const varName = decls[0].name.text;
  const initOp = callWord(ctx, stmt.initializer, "letVar", [
    varName,
    loweredToScriptValue(lowered),
  ]);
  if (initOp === undefined) return [];
  const cond =
    stmt.condition === undefined ? undefined : lowerCond(ctx, stmt.condition);
  if (cond === undefined) {
    diag(ctx, stmt, "for 缺少循环条件");
    return [];
  }
  const scope: Scope = new Map([[varName, { kind: "let" }]]);
  ctx.scopes.push(scope);
  ctx.breakables.push("loop");
  const body = translateBlockBody(ctx, stmt.statement, dispatch);
  const update = translateForUpdate(ctx, stmt);
  ctx.breakables.pop();
  ctx.scopes.pop();
  if (update.length === 0 && stmt.incrementor !== undefined) return [];
  if (stmt.incrementor === undefined) {
    diag(
      ctx,
      stmt,
      "for 缺少更新表达式（循环会无法推进；固定次数请用 staticFor）",
    );
    return [];
  }
  const op = callWord(ctx, stmt, "whileDo", [cond, [...body, ...update]]);
  return op === undefined ? [] : [initOp, op];
}

function translateForUpdate(
  ctx: BodyCtx,
  stmt: ts.ForStatement,
): StoryCommand[] {
  const inc = stmt.incrementor;
  if (inc === undefined) return [];
  const sf = ctx.shared.mod.sf;
  if (
    ts.isBinaryExpression(inc) &&
    isAssignmentOperator(inc.operatorToken.getText(sf))
  ) {
    return emitAssignment(
      ctx,
      inc,
      inc.left,
      inc.operatorToken.getText(sf),
      inc.right,
    );
  }
  if (ts.isPrefixUnaryExpression(inc) || ts.isPostfixUnaryExpression(inc)) {
    return translateIncrement(ctx, inc);
  }
  diag(ctx, inc, "for 更新表达式只支持赋值或 ++/--");
  return [];
}
