import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { foldConst } from "../graph.ts";
import { WORDS, diag, lookupBinding, lookupScope } from "./shared.ts";
import type { BodyCtx, Scope } from "./shared.ts";
import { lowerValue, loweredToScriptValue } from "./expr.ts";
import { checkFontReferences } from "./font-check.ts";

const STATIC_FOR_MAX = 100000;

// —— 词实参求值（静态求值 + 嵌套命令递归）——

function evaluateWordArg(ctx: BodyCtx, expr: ts.Expression): unknown {
  if (ts.isIdentifier(expr) && expr.text === "undefined") return undefined;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    diag(ctx, expr, "函数实参仅 staticFor 支持");
    return undefined;
  }
  if (ts.isIdentifier(expr)) {
    const binding = lookupBinding(ctx, expr.text);
    if (binding?.kind === "cell") {
      return { name: binding.guard };
    }
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const out: unknown[] = [];
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el)) {
        diag(ctx, el, "展开实参不支持");
        return undefined;
      }
      const item = evaluateWordArg(ctx, el);
      const isExplicitUndefined =
        ts.isIdentifier(el) && el.text === "undefined";
      if (item === undefined && !isExplicitUndefined) return undefined;
      out.push(item);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const out: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        diag(
          ctx,
          prop,
          "对象实参只支持 key: value 形式（不支持展开/方法/计算键）",
        );
        return undefined;
      }
      const key =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : undefined;
      if (key === undefined) {
        diag(ctx, prop, "对象实参键必须是标识符或字符串字面量");
        return undefined;
      }
      const value = evaluateWordArg(ctx, prop.initializer);
      const isExplicitUndefined =
        ts.isIdentifier(prop.initializer) &&
        prop.initializer.text === "undefined";
      if (value === undefined && !isExplicitUndefined) return undefined;
      out[key] = value;
    }
    return out;
  }
  if (ts.isCallExpression(expr)) {
    // 值位置的词调用也得分具名与 `script.` 命名空间两种写法——`option(...)` 能当菜单
    // 选项、`script.option(...)` 同样是同一个词，落到 lowerValue 只会得到「值位置的函数
    // 调用不支持」，而真正该报的是这个词自己的实参问题。
    const wordName = wordCalleeName(ctx, expr);
    if (wordName !== undefined) {
      const ops = emitCommand(ctx, expr);
      if (ops.length === 0) return undefined;
      if (ops.length !== 1) {
        diag(ctx, expr, `值位置词调用 \`${wordName}\` 必须恰好产出一个命令`);
        return undefined;
      }
      return ops[0];
    }
  }
  const lowered = lowerValue(ctx, expr);
  if (lowered === undefined) return undefined;
  return loweredToScriptValue(lowered);
}

// —— 命令发射 ——

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

function emitJump(
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

function foldStaticCount(
  ctx: BodyCtx,
  expr: ts.Expression,
): number | undefined {
  const value = foldConst(
    expr,
    ctx.shared.mod.sf,
    ctx.shared.diags,
    ctx.shared.file,
    (name) => {
      const scoped = lookupScope(ctx, name);
      if (scoped?.kind === "index" && typeof scoped.value === "number") {
        return { kind: "const", value: scoped.value };
      }
      return lookupBinding(ctx, name);
    },
  );
  if (
    value === undefined ||
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    diag(ctx, expr, "staticFor 次数必须是编译期可折叠的整数");
    return undefined;
  }
  return value;
}

function emitStaticFor(ctx: BodyCtx, call: ts.CallExpression): StoryCommand[] {
  if (call.arguments.length !== 2) {
    diag(ctx, call, "staticFor(count, generator) 恰好接受两个实参");
    return [];
  }
  const count = foldStaticCount(ctx, call.arguments[0]);
  if (count === undefined) return [];
  if (count < 0) {
    diag(ctx, call.arguments[0], "staticFor 次数不能为负");
    return [];
  }
  if (count > STATIC_FOR_MAX) {
    diag(ctx, call.arguments[0], `staticFor 展开量超限（>${STATIC_FOR_MAX}）`);
    return [];
  }
  const generator = call.arguments[1];
  if (
    !ts.isArrowFunction(generator) ||
    generator.parameters.length !== 1 ||
    !ts.isIdentifier(generator.parameters[0].name)
  ) {
    diag(ctx, generator, "staticFor 生成器必须是单参数箭头函数");
    return [];
  }
  if (!ts.isArrayLiteralExpression(generator.body)) {
    diag(
      ctx,
      generator.body,
      "staticFor 生成器函数体必须是数组字面量（命令列表）",
    );
    return [];
  }
  const paramName = generator.parameters[0].name.text;
  const out: StoryCommand[] = [];
  for (let i = 0; i < count; i += 1) {
    const scope: Scope = new Map([[paramName, { kind: "index", value: i }]]);
    ctx.scopes.push(scope);
    try {
      for (const element of generator.body.elements) {
        if (!ts.isCallExpression(element)) {
          diag(
            ctx,
            element,
            "staticFor 生成器元素只能是词函数调用或 staticFor 调用",
          );
          continue;
        }
        out.push(...emitCommand(ctx, element));
      }
    } finally {
      ctx.scopes.pop();
    }
  }
  return out;
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

/**
 * 取调用表达式的**词名**——具名标识符、`script.` 属性访问与免导入 ambient 直呼
 * 三种形态在这里归一，免得下面的特判（jump / staticFor / cell）、实参求值与值位置
 * 通道各写三遍、漏掉一边。
 *
 * ambient 直呼（作者不写 `import { script }` 也用 `script.bgm(...)`，类型来自
 * gen/script.gen.d.ts 的全局声明）只在接收者恰为标识符 `script`、且绑定表与函数
 * 作用域都没有同名遮蔽时兜底——模块层自有同名声明按 TS 遮蔽语义优先，不在此解析。
 *
 * 返回 undefined 表示这个 callee 不是词调用（普通函数、`obj.method()` 等），该走别的分支。
 */
function wordCalleeName(
  ctx: BodyCtx,
  call: ts.CallExpression,
): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const binding = lookupBinding(ctx, callee.text);
    // 用 binding.name（声明名）而非 callee.text：`import { say as 说 }` 后调用点是 `说()`，
    // 但词表里登记的名字仍是 say。
    return binding?.kind === "word" ? binding.name : undefined;
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression)
  ) {
    const receiver = callee.expression.text;
    const target = lookupBinding(ctx, receiver);
    if (target?.kind === "namespace") return callee.name.text;
    if (
      receiver === "script" &&
      target === undefined &&
      lookupScope(ctx, receiver) === undefined
    ) {
      return callee.name.text;
    }
  }
  return undefined;
}

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
  if (wordName === "staticFor") return emitStaticFor(ctx, call);
  if (wordName === "cell") {
    diag(ctx, call, "cell 是构建期声明词，只能用于模块层 const，不能作为命令");
    return [];
  }
  const args = call.arguments.map((arg) => evaluateWordArg(ctx, arg));
  const op = callWord(ctx, call, wordName, args);
  return op === undefined ? [] : [op];
}

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

// —— 赋值 ——
