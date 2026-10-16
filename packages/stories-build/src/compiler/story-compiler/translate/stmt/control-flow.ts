import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { foldConst } from "../../graph.ts";
import {
  diag,
  lookupBinding,
  lookupScope,
  isAssignmentOperator,
} from "../shared.ts";
import type { BodyCtx, Scope } from "../shared.ts";
import { statePath } from "../expr/expr-core.ts";
import { lowerCond, lowerValue, loweredToScriptValue } from "../expr/expr.ts";
import { callWord } from "../expr/words.ts";
import { emitAssignment, translateIncrement } from "../expr/assign.ts";

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

function isUnlabeledBreak(stmt: ts.Statement): boolean {
  return ts.isBreakStatement(stmt) && stmt.label === undefined;
}

export function translateBlockBody(
  ctx: BodyCtx,
  stmt: ts.Statement,
  dispatch: StatementDispatch,
): StoryCommand[] {
  if (ts.isBlock(stmt)) return dispatch.statements(ctx, stmt.statements);
  return dispatch.statement(ctx, stmt);
}

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
