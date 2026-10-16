import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { diag, lookupBinding } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import {
  callWord,
  emitCallCommand,
  emitJump,
  resolveFunctionCallee,
} from "./call.ts";
import { emitStaticFor } from "./static-for.ts";
import { evaluateWordArg } from "./arg.ts";
import { wordCalleeName } from "./callee.ts";
import type { WordDispatch } from "./dispatch.ts";

/**
 * 发射一条词命令。三条特判（jump / staticFor / cell）按**词名**判定，与 callee 写成
 * 具名标识符还是 `script.` 属性访问无关——同一个词换个写法必须落到同一条路径，
 * 否则 `script.staticFor(...)` 会被当普通命令词去求值实参，报出与 `staticFor(...)`
 * 完全不同的文案。
 *
 * 返回数组而非单条命令：staticFor 会静态展开成多条（`staticFor(3, …)` → 3 条命令），
 * 是这条通道里唯一的展开点。调用方负责扁平化。
 */
function emitWordCommand(
  ctx: BodyCtx,
  call: ts.CallExpression,
  wordName: string,
): StoryCommand[] {
  if (wordName === "jump") {
    const op = emitJump(ctx, call);
    return op === undefined ? [] : [op];
  }
  if (wordName === "staticFor") return emitStaticFor(ctx, call, DISPATCH);
  if (wordName === "cell") {
    diag(ctx, call, "cell 是构建期声明词，只能用于模块层 const，不能作为命令");
    return [];
  }
  const args = call.arguments.map((arg) => evaluateWordArg(ctx, arg, DISPATCH));
  const op = callWord(ctx, call, wordName, args);
  return op === undefined ? [] : [op];
}

/** 命令发射总入口：本文件即递归入口，自引用注入给实参求值与 staticFor 展开 */
const DISPATCH: WordDispatch = {
  command(ctx, call) {
    return emitCommand(ctx, call);
  },
};

export function emitCommand(
  ctx: BodyCtx,
  call: ts.CallExpression,
): StoryCommand[] {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const fn = resolveFunctionCallee(ctx, call);
    if (fn !== undefined) {
      const op = emitCallCommand(ctx, call, fn);
      return op === undefined ? [] : [op];
    }
    const name = callee.text;
    const binding = lookupBinding(ctx, name);
    if (binding === undefined) {
      diag(ctx, call, `未知调用目标 \`${name}\`（须是词函数或声明的函数）`);
      return [];
    }
    if (binding.kind === "word") {
      return emitWordCommand(ctx, call, binding.name);
    }
    if (binding.kind === "declare" && name === "jump") {
      const op = emitJump(ctx, call);
      return op === undefined ? [] : [op];
    }
    diag(ctx, call, `\`${name}\` 是 ${binding.kind} 绑定，不是可发射的命令`);
    return [];
  }
  const word = wordCalleeName(ctx, call);
  if (word !== undefined) {
    return emitWordCommand(ctx, call, word);
  }
  // 属性访问但接收者不是词汇层命名空间（`obj.method()` 之类）：这条文案比末尾的通用文案更能
  // 指路，故单独保留，避免重构时遗漏。
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression)
  ) {
    diag(ctx, call, "方法调用不支持：词函数通过具名导入或 script 命名空间调用");
    return [];
  }
  diag(ctx, call, "命令只能是词函数/函数调用");
  return [];
}
