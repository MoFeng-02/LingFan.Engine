import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import type { BodyCtx } from "../shared.ts";

/**
 * 语句递归入口：块体与 `case` 体由此下探。
 *
 * 控制流语句的体内可以再出现控制流语句，本族与语句分发器天然互相递归；
 * 入口由调用方**注入**（本模块不 import 分发器）。
 */
export interface StatementDispatch {
  /** 单条语句 → 命令序列 */
  statement(ctx: BodyCtx, stmt: ts.Statement): StoryCommand[];
  /** 语句列表 → 命令序列 */
  statements(ctx: BodyCtx, stmts: readonly ts.Statement[]): StoryCommand[];
}

export function translateBlockBody(
  ctx: BodyCtx,
  stmt: ts.Statement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  if (ts.isBlock(stmt)) return dispatch.statements(ctx, stmt.statements);
  return dispatch.statement(ctx, stmt);
}
