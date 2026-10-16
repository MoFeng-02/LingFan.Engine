import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { WORDS, diag, lookupBinding, lookupScope } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import { lowerValue, loweredToScriptValue } from "../expr.ts";
import { checkFontReferences } from "../../font-check.ts";

export function callWord(
  ctx: BodyCtx,
  node: ts.Node,
  name: string,
  args: unknown[],
): StoryCommand | undefined {
  const word = WORDS[name];
  if (word === undefined) {
    // 未知词的第一现场（ambient 直呼也汇到这里），文案单点指路两条调用形态。
    diag(
      ctx,
      node,
      `词汇层不存在词 \`${name}\`——词函数经 \`script.\` 命名空间或具名导入调用，请核对词名`,
    );
    return undefined;
  }
  try {
    const product = word(...args);
    if (product === null || typeof product !== "object") {
      diag(ctx, node, `词 \`${name}\` 未返回命令对象`);
      return undefined;
    }
    // 字体引用检查单点：所有词命令都经此处产出（jump/值位置词调用同走），静态可达面全覆盖
    checkFontReferences(ctx, node, product);
    return product;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diag(ctx, node, `词 \`${name}\` 实参形态非法：${message}`);
    return undefined;
  }
}

export function emitJump(
  ctx: BodyCtx,
  call: ts.CallExpression,
): StoryCommand | undefined {
  if (call.arguments.length !== 1) {
    diag(ctx, call, "jump 恰好接受一个实参（导入的故事标识符或列名字符串）");
    return undefined;
  }
  const arg = call.arguments[0];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return callWord(ctx, call, "jump", [arg.text]);
  }
  if (ts.isIdentifier(arg)) {
    const binding = lookupBinding(ctx, arg.text);
    if (binding?.kind === "story") {
      return callWord(ctx, call, "jump", [binding.name]);
    }
    diag(
      ctx,
      arg,
      `jump 实参 \`${arg.text}\` 不是导入的故事（default 导出函数）`,
    );
    return undefined;
  }
  diag(ctx, arg, "jump 实参必须是导入的故事标识符或字符串字面量");
  return undefined;
}

/**
 * 解析「函数 callee」：具名标识符，绑定面（词表 import）或函数作用域里命中
 * kind 为 function 的绑定。返回 undefined = 这个 callee 不是子程序调用
 * （词调用、`obj.method()`、未知名字），由各调用方走自己的分支。
 *
 * emitCommand 与语句级 `const x = f(1)` 拦截共用，保证两种位置对「什么算函数」
 * 的判定逐字节一致。
 */
export function resolveFunctionCallee(
  ctx: BodyCtx,
  call: ts.CallExpression,
): { name: string; file: string } | undefined {
  const callee = call.expression;
  if (!ts.isIdentifier(callee)) return undefined;
  const name = callee.text;
  let binding = lookupBinding(ctx, name);
  const scopedFn = lookupScope(ctx, name);
  if (scopedFn?.kind === "function") {
    binding = {
      kind: "function",
      name,
      file: scopedFn.file ?? ctx.shared.file,
    };
  }
  return binding?.kind === "function"
    ? { name: binding.name, file: binding.file }
    : undefined;
}

export function emitCallCommand(
  ctx: BodyCtx,
  call: ts.CallExpression,
  fn: { name: string; file: string },
  into?: string,
): StoryCommand | undefined {
  const args: Array<string | number | boolean> = [];
  for (const arg of call.arguments) {
    const lowered = lowerValue(ctx, arg);
    if (lowered === undefined) continue;
    args.push(loweredToScriptValue(lowered));
  }
  // refs 的键与 call.target 都用**声明名**：`import { alpha as ah }` 后调用点是 `ah()`，
  // 但已发射的 func 声明名叫 alpha，函数体登记（funcs.body）也按声明名索引。用调用点
  // 局部名会得到一个永远解析不到的函数引用——产物里留下悬空的 call。
  // fn 由 resolveFunctionCallee 给出（携带声明名 + 声明文件），此处不再二次查绑定面：
  // 别名场景按声明名回查必然落空，会把声明文件错记成当前文件、refs 归位到错误文件。
  ctx.shared.funcs.refs.set(`${fn.file}#${fn.name}`, {
    file: fn.file,
    name: fn.name,
  });
  // into = 结果绑定名（语句级 const x = f(1) 的降级形态）：引擎把 ret 带值
  // 声明成调用方局部变量，无带值 ret / 自然跑完则绑 null
  return callWord(ctx, call, "call", [
    fn.name,
    args,
    ...(into === undefined ? [] : [into]),
  ]);
}
