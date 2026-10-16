import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { diag, isAssignmentOperator } from "../shared.ts";
import type { BodyCtx } from "../shared.ts";
import {
  callWord,
  emitAssignment,
  emitCommand,
  lowerValue,
  loweredToScriptValue,
  translateIncrement,
  translateVariableStatement,
} from "../expr/index.ts";
import type { StatementDispatch } from "./control-flow.ts";
import {
  translateIf,
  translateWhile,
  translateFor,
  translateForOf,
  translateSwitch,
} from "./control/index.ts";

/** 语句递归入口：本文件即分发器，自引用注入给控制流族（见 `StatementDispatch`） */
const DISPATCH: StatementDispatch = {
  statement: translateStatement,
  statements: translateStatements,
};

export function translateStatement(
  ctx: BodyCtx,
  stmt: ts.Statement,
): StoryCommand[] {
  const sf = ctx.shared.mod.sf;
  if (ts.isVariableStatement(stmt))
    return translateVariableStatement(ctx, stmt);
  if (ts.isExpressionStatement(stmt)) {
    const expr = stmt.expression;
    if (ts.isCallExpression(expr)) return emitCommand(ctx, expr);
    if (
      ts.isBinaryExpression(expr) &&
      isAssignmentOperator(expr.operatorToken.getText(sf))
    ) {
      return emitAssignment(
        ctx,
        expr,
        expr.left,
        expr.operatorToken.getText(sf),
        expr.right,
      );
    }
    if (ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) {
      return translateIncrement(ctx, expr);
    }
    diag(ctx, stmt, "表达式语句只能是词函数/函数调用或赋值");
    return [];
  }
  if (ts.isIfStatement(stmt)) return translateIf(ctx, stmt, DISPATCH);
  if (ts.isWhileStatement(stmt)) return translateWhile(ctx, stmt, DISPATCH);
  if (ts.isDoStatement(stmt)) {
    diag(ctx, stmt, "do-while 不支持：请改写为 while（先求值再循环）");
    return [];
  }
  if (ts.isForStatement(stmt)) return translateFor(ctx, stmt, DISPATCH);
  if (ts.isForOfStatement(stmt)) return translateForOf(ctx, stmt, DISPATCH);
  if (ts.isForInStatement(stmt)) {
    diag(ctx, stmt, "for-in 不支持：对象遍历请改用明确的状态键读取");
    return [];
  }
  if (ts.isSwitchStatement(stmt)) return translateSwitch(ctx, stmt, DISPATCH);
  if (ts.isReturnStatement(stmt)) {
    if (!ctx.inFunction) {
      diag(ctx, stmt, ctx.shared.texts.topLevelReturn());
      return [];
    }
    if (stmt.expression !== undefined) {
      // 带值 return：调用点用 `call into` 接收（语句级 const x = f(1) 降级形态）；
      // 不带 into 的调用点把返回值静默丢弃（向后兼容旧故事）
      const lowered = lowerValue(ctx, stmt.expression);
      if (lowered === undefined) return [];
      const op = callWord(ctx, stmt, "ret", [loweredToScriptValue(lowered)]);
      return op === undefined ? [] : [op];
    }
    const op = callWord(ctx, stmt, "ret", []);
    return op === undefined ? [] : [op];
  }
  if (ts.isBreakStatement(stmt)) {
    if (stmt.label !== undefined) {
      diag(ctx, stmt, "带标签 break 不支持");
      return [];
    }
    if (ctx.breakables.length === 0) {
      diag(ctx, stmt, ctx.shared.texts.breakOutsideLoop());
      return [];
    }
    if (ctx.breakables[ctx.breakables.length - 1] === "switch") {
      return [];
    }
    const op = callWord(ctx, stmt, "breakLoop", []);
    return op === undefined ? [] : [op];
  }
  if (ts.isContinueStatement(stmt)) {
    if (stmt.label !== undefined) {
      diag(ctx, stmt, "带标签 continue 不支持");
      return [];
    }
    for (let i = ctx.breakables.length - 1; i >= 0; i -= 1) {
      if (ctx.breakables[i] === "loop") {
        const op = callWord(ctx, stmt, "continueLoop", []);
        return op === undefined ? [] : [op];
      }
    }
    diag(ctx, stmt, ctx.shared.texts.continueOutsideLoop());
    return [];
  }
  if (ts.isFunctionDeclaration(stmt)) {
    if (stmt.body === undefined) return [];
    diag(
      ctx,
      stmt,
      "块内函数声明不支持：函数请声明在函数体/列体顶层（会前置为 func 命令）",
    );
    return [];
  }
  if (ts.isBlock(stmt)) return translateStatements(ctx, stmt.statements);
  if (ts.isEmptyStatement(stmt)) return [];
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
    return [];
  diag(
    ctx,
    stmt,
    "此语句不支持转译（转译总表：if/while/for/for-of/switch/return/break/continue/let/赋值/调用）",
  );
  return [];
}

export function translateStatements(
  ctx: BodyCtx,
  statements: readonly ts.Statement[],
): StoryCommand[] {
  const out: StoryCommand[] = [];
  for (const stmt of statements) {
    out.push(...translateStatement(ctx, stmt));
  }
  return out;
}
