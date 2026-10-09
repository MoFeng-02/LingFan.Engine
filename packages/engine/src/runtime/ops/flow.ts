/**
 * 流程控制命令的执行：if / assert / guard / while / for / foreach / switch。
 *
 * 这一族的共同点是「在运行期决定接下来走哪一段」——条件、断言、守卫、循环、分支。
 * 条件和表达式都在执行期求值（不是编译期），所以同一份故事在不同状态下会走不同分支；
 * 这也意味着求值失败必须当场停机，不能猜一个默认值继续跑。
 *
 * 循环用「循环帧」表达：帧上挂一个循环描述，帧耗尽时由解释循环重判条件或推进下一轮，
 * 于是 while/for/foreach 三种写法共享同一套推进逻辑。
 */
import type { GuardContext, StoryCommand } from "../../contracts";
import {
  ExpressionError,
  evaluateExpression,
  exprEquals,
  type ExprValue,
} from "../expr";
import {
  GuardFailure,
  type Frame,
  type LoopState,
  type OpContext,
} from "../internal";
import { findJsonValueError } from "../stateContract";

/** if/elif/else：条件执行期求值；分支体 = 块帧 + 块级作用域 */
export function execIf(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const cond = ctx.evalCond(cmd.cond);
  if (cond === null) return false;
  let branch: readonly StoryCommand[] | undefined = cond
    ? (cmd.then as readonly StoryCommand[])
    : undefined;
  if (branch === undefined && Array.isArray(cmd.elif)) {
    for (const elif of cmd.elif as Array<{
      cond: unknown;
      then: StoryCommand[];
    }>) {
      const c = ctx.evalCond(elif.cond);
      if (c === null) return false;
      if (c) {
        branch = elif.then;
        break;
      }
    }
  }
  if (branch === undefined && Array.isArray(cmd.else))
    branch = cmd.else as StoryCommand[];
  frame.index += 1;
  if (branch === undefined || branch.length === 0) return true;
  ctx.frames.push({
    columnId: null,
    commands: branch,
    index: 0,
    scope: frame.scope.enterChild(), // 块级作用域：出块销毁
  });
  return true;
}

/**
 * assert：断言校验（拦截语义，不静默跳过）。
 * cond 求值为假 ⇒ `engine.error`（code = assert-failed）+ 停在当前命令
 * （状态原样、不推进——作者可用重写源/数据修正后重放；重放同位同判 = 回溯安全）。
 * 为真 = 纯推进（无副作用、不产系统键 ⇒ 键序列与既有测试零冲突）。
 */
export function execAssert(ctx: OpContext, cmd: StoryCommand): boolean {
  const cond = ctx.evalCond(cmd.cond);
  if (cond === null) return false; // 表达式求值错误（fail 已在 evalCond 内出站）
  if (cond) return true;
  const message =
    typeof cmd.message === "string" && cmd.message !== ""
      ? cmd.message
      : String(cmd.cond ?? "");
  ctx.fail("assert-failed", `断言失败：${message}`);
  return false;
}

/**
 * guard：运行期守卫（组合根注册制）。
 * 未注册名 / args 非 JSON 安全 / ctx.fail / 抛出 ⇒ engine.error + 停在当前命令
 * （状态原样 + 阻止推进）。通过 = 纯推进。守卫不改状态（ctx 无 set——职责分离）。
 */
export function execGuard(ctx: OpContext, cmd: StoryCommand): boolean {
  const name = typeof cmd.fn === "string" ? cmd.fn : "";
  const guard = ctx.guards[name];
  if (guard === undefined) {
    ctx.fail("guard-unknown", `未注册的守卫：${name === "" ? "(空)" : name}`);
    return false;
  }
  const args = (cmd.args ?? {}) as Record<string, unknown>;
  const unsafe = findJsonValueError(args, "args"); // 故事数据来的参数必须 JSON 安全
  if (unsafe !== null) {
    ctx.fail("guard-args-unsafe", `守卫 ${name} 参数非 JSON 安全：${unsafe}`);
    return false;
  }
  const guardCtx: GuardContext = {
    get: (key) => ctx.get(key),
    fail: (message) => {
      throw new GuardFailure(message);
    },
  };
  try {
    guard(guardCtx, args);
    return true;
  } catch (error) {
    if (error instanceof GuardFailure) {
      ctx.fail("guard-failed", error.message);
    } else {
      ctx.fail(
        "guard-threw",
        `守卫 ${name} 抛出：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return false;
  }
}

/** while：条件执行期求值；body = 循环帧（每轮重判条件） */
export function execWhile(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  const cond = ctx.evalCond(cmd.cond);
  if (cond === null) return false;
  frame.index += 1;
  if (!cond) return true;
  const loop: LoopState = {
    kind: "while",
    cond: cmd.cond,
    parentScope: frame.scope,
    iterations: 0,
  };
  ctx.frames.push({
    columnId: null,
    commands: cmd.body as readonly StoryCommand[],
    index: 0,
    scope: frame.scope,
    loop,
  });
  return ctx.beginLoopIteration(ctx.frames[ctx.frames.length - 1]!, loop);
}

/** for：`in` 表达式执行期求值 → 必须为数组，逐元素迭代 */
export function execFor(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  try {
    const src = typeof cmd.in === "string" ? cmd.in.trim() : "";
    const inner =
      src.startsWith("{") && src.endsWith("}") ? src.slice(1, -1) : src;
    const value = evaluateExpression(inner, ctx.resolveName, () => ctx.draw());
    if (!Array.isArray(value)) {
      ctx.fail("type-error", "for 的 in 表达式必须为数组");
      return false;
    }
    return ctx.pushIterateLoop(frame, cmd, value as ExprValue[]);
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** foreach：key 为集合变量名（foreach "v" in "k"，编译为 for 同构） */
export function execForeach(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  try {
    const key = cmd.key as string;
    const hit = ctx.resolveName(key);
    if (!hit.found || !Array.isArray(hit.value)) {
      ctx.fail("type-error", `foreach 集合 ${key} 不存在或不是数组`);
      return false;
    }
    return ctx.pushIterateLoop(frame, cmd, hit.value as ExprValue[]);
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}

/** switch：编译为 if/else 链——case 字面量相等比较，命中即走、不穿透 */
export function execSwitch(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): boolean {
  try {
    const src = typeof cmd.on === "string" ? cmd.on.trim() : "";
    const inner =
      src.startsWith("{") && src.endsWith("}") ? src.slice(1, -1) : src;
    const value = evaluateExpression(inner, ctx.resolveName, () => ctx.draw());
    let body: readonly StoryCommand[] | undefined;
    for (const c of cmd.cases as Array<{
      value: unknown;
      body: StoryCommand[];
    }>) {
      if (exprEquals(value, c.value as ExprValue)) {
        body = c.body;
        break;
      }
    }
    if (body === undefined && Array.isArray(cmd.default)) {
      body = cmd.default as StoryCommand[];
    }
    frame.index += 1;
    if (body === undefined || body.length === 0) return true;
    ctx.frames.push({
      columnId: null,
      commands: body,
      index: 0,
      scope: frame.scope.enterChild(),
    });
    return true;
  } catch (e) {
    if (e instanceof ExpressionError) {
      ctx.fail(e.code, e.message);
      return false;
    }
    throw e;
  }
}
