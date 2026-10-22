import * as ts from "typescript";
import type { StoryCommand } from "@lingfan-engine/core";
import { foldConst } from "../../../graph.ts";
import { diag, lookupBinding } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import { lowerCond } from "../../expr/expr.ts";
import { callWord } from "../../expr/words/index.ts";
import type { StatementDispatch } from "../control-flow.ts";

function isUnlabeledBreak(stmt: ts.Statement): boolean {
  return ts.isBreakStatement(stmt) && stmt.label === undefined;
}

export function translateSwitch(
  ctx: BodyCtx,
  stmt: ts.SwitchStatement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  const sf = ctx.shared.mod.sf;
  const on = lowerCond(ctx, stmt.expression);
  if (on === undefined) return [];
  const clauses = stmt.caseBlock.clauses;
  const cases: Array<[string | number | boolean, StoryCommand[]]> = [];
  let defaultBody: StoryCommand[] | undefined;
  for (let i = 0; i < clauses.length; i += 1) {
    const clause = clauses[i];
    const isLast = i === clauses.length - 1;
    const body = clause.statements;
    const endsWithBreak =
      body.length > 0 && isUnlabeledBreak(body[body.length - 1]);
    if (body.length === 0 && !isLast) {
      diag(
        ctx,
        clause,
        "case 体不能为空（引擎 switch 无穿透，请合并条件或补 break）",
      );
      continue;
    }
    if (body.length > 0 && !endsWithBreak && !isLast) {
      diag(ctx, clause, "case 体必须以 break 收尾（引擎 switch 无穿透）");
      continue;
    }
    ctx.scopes.push(new Map());
    ctx.breakables.push("switch");
    const commands = dispatch.statements(ctx, body);
    ctx.breakables.pop();
    ctx.scopes.pop();
    if (ts.isDefaultClause(clause)) {
      if (defaultBody !== undefined) {
        diag(ctx, clause, "重复的 default 分支");
        continue;
      }
      defaultBody = commands;
      continue;
    }
    const value = foldConst(
      clause.expression,
      sf,
      ctx.shared.diags,
      ctx.shared.file,
      (name) => lookupBinding(ctx, name),
    );
    if (value === undefined || value === null) {
      diag(
        ctx,
        clause.expression,
        "case 值必须是字面量或可折叠的模块常量/枚举成员",
      );
      continue;
    }
    cases.push([value, commands]);
  }
  const op = callWord(ctx, stmt, "switchOn", [on, cases, defaultBody]);
  return op === undefined ? [] : [op];
}
