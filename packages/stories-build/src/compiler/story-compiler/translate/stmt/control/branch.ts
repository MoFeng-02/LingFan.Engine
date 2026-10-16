import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import type { BodyCtx } from "../../shared.ts";
import { lowerCond } from "../../expr/expr.ts";
import { callWord } from "../../expr/words/index.ts";
import { translateBlockBody } from "../control-flow.ts";
import type { StatementDispatch } from "../control-flow.ts";

interface IfChainInput {
  branches: Array<{ cond: ts.Expression; then: ts.Statement }>;
  elseStmt: ts.Statement | undefined;
}

function collectIfChain(stmt: ts.IfStatement): IfChainInput {
  const branches: Array<{ cond: ts.Expression; then: ts.Statement }> = [
    { cond: stmt.expression, then: stmt.thenStatement },
  ];
  let current = stmt;
  while (
    current.elseStatement !== undefined &&
    ts.isIfStatement(current.elseStatement)
  ) {
    current = current.elseStatement;
    branches.push({ cond: current.expression, then: current.thenStatement });
  }
  return { branches, elseStmt: current.elseStatement };
}

interface Chain {
  elif(cond: string, body: StoryCommand[]): Chain;
  else(body: StoryCommand[]): StoryCommand;
  end(): StoryCommand;
}

export function translateIf(
  ctx: BodyCtx,
  stmt: ts.IfStatement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  const { branches, elseStmt } = collectIfChain(stmt);
  const rendered: Array<[string, StoryCommand[]]> = [];
  for (const branch of branches) {
    const cond = lowerCond(ctx, branch.cond);
    if (cond === undefined) return [];
    ctx.scopes.push(new Map());
    const body = translateBlockBody(ctx, branch.then, dispatch);
    ctx.scopes.pop();
    rendered.push([cond, body]);
  }
  let elseBody: StoryCommand[] = [];
  if (elseStmt !== undefined) {
    ctx.scopes.push(new Map());
    elseBody = translateBlockBody(ctx, elseStmt, dispatch);
    ctx.scopes.pop();
  }
  const [firstCond, firstThen] = rendered[0];
  if (branches.length === 1 && elseStmt === undefined) {
    const op = callWord(ctx, stmt, "when", [firstCond, firstThen]);
    return op === undefined ? [] : [op];
  }
  const chainOp = callWord(ctx, stmt, "whenChain", [firstCond, firstThen]);
  if (chainOp === undefined) return [];
  const chain = chainOp as unknown as Chain;
  let result = chain;
  for (let i = 1; i < rendered.length; i += 1) {
    result = result.elif(rendered[i][0], rendered[i][1]) as Chain;
  }
  const finished =
    elseStmt !== undefined ? result.else(elseBody) : result.end();
  return [finished];
}
