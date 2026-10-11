import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { foldConst } from "../graph";
import { WORDS, diag, lookupBinding, lookupScope } from "./shared";
import type { BodyCtx, Scope } from "./shared";
import { lowerValue, loweredToScriptValue } from "./expr";

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
      const isExplicitUndefined = ts.isIdentifier(el) && el.text === "undefined";
      if (item === undefined && !isExplicitUndefined) return undefined;
      out.push(item);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const out: Record<string, unknown> = {};
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        diag(ctx, prop, "对象实参只支持 key: value 形式（不支持展开/方法/计算键）");
        return undefined;
      }
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined;
      if (key === undefined) {
        diag(ctx, prop, "对象实参键必须是标识符或字符串字面量");
        return undefined;
      }
      const value = evaluateWordArg(ctx, prop.initializer);
      const isExplicitUndefined = ts.isIdentifier(prop.initializer) && prop.initializer.text === "undefined";
      if (value === undefined && !isExplicitUndefined) return undefined;
      out[key] = value;
    }
    return out;
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee) && lookupBinding(ctx, callee.text)?.kind === "word") {
      const ops = emitCommand(ctx, expr);
      if (ops.length === 0) return undefined;
      if (ops.length !== 1) {
        diag(ctx, expr, `值位置词调用 \`${callee.text}\` 必须恰好产出一个命令`);
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

export function callWord(ctx: BodyCtx, node: ts.Node, name: string, args: unknown[]): StoryCommand | undefined {
  const word = WORDS[name];
  if (word === undefined) {
    diag(ctx, node, `词汇层不存在词 \`${name}\``);
    return undefined;
  }
  try {
    const product = word(...args);
    if (product === null || typeof product !== "object") {
      diag(ctx, node, `词 \`${name}\` 未返回命令对象`);
      return undefined;
    }
    return product;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diag(ctx, node, `词 \`${name}\` 实参形态非法：${message}`);
    return undefined;
  }
}

function emitJump(ctx: BodyCtx, call: ts.CallExpression): StoryCommand | undefined {
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
    diag(ctx, arg, `jump 实参 \`${arg.text}\` 不是导入的故事（default 导出函数）`);
    return undefined;
  }
  diag(ctx, arg, "jump 实参必须是导入的故事标识符或字符串字面量");
  return undefined;
}

function foldStaticCount(ctx: BodyCtx, expr: ts.Expression): number | undefined {
  const value = foldConst(expr, ctx.shared.mod.sf, ctx.shared.diags, ctx.shared.file, (name) => {
    const scoped = lookupScope(ctx, name);
    if (scoped?.kind === "index" && typeof scoped.value === "number") {
      return { kind: "const", value: scoped.value };
    }
    return lookupBinding(ctx, name);
  });
  if (value === undefined || typeof value !== "number" || !Number.isInteger(value)) {
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
  if (!ts.isArrowFunction(generator) || generator.parameters.length !== 1 || !ts.isIdentifier(generator.parameters[0].name)) {
    diag(ctx, generator, "staticFor 生成器必须是单参数箭头函数");
    return [];
  }
  if (!ts.isArrayLiteralExpression(generator.body)) {
    diag(ctx, generator.body, "staticFor 生成器函数体必须是数组字面量（命令列表）");
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
          diag(ctx, element, "staticFor 生成器元素只能是词函数调用或 staticFor 调用");
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

function emitCallCommand(ctx: BodyCtx, call: ts.CallExpression, fnName: string): StoryCommand | undefined {
  const args: Array<string | number | boolean> = [];
  for (const arg of call.arguments) {
    const lowered = lowerValue(ctx, arg);
    if (lowered === undefined) continue;
    args.push(loweredToScriptValue(lowered));
  }
  const binding = lookupBinding(ctx, fnName);
  const originFile = binding?.kind === "function" ? binding.file : ctx.shared.file;
  ctx.shared.funcs.refs.set(`${originFile}#${fnName}`, { file: originFile, name: fnName });
  return callWord(ctx, call, "call", [fnName, args]);
}

export function emitCommand(ctx: BodyCtx, call: ts.CallExpression): StoryCommand[] {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    const name = callee.text;
    let binding = lookupBinding(ctx, name);
    const scopedFn = lookupScope(ctx, name);
    if (scopedFn?.kind === "function") {
      binding = { kind: "function", name, file: scopedFn.file ?? ctx.shared.file };
    }
    if (binding === undefined) {
      diag(ctx, call, `未知调用目标 \`${name}\`（须是词函数或声明的函数）`);
      return [];
    }
    if (binding.kind === "word") {
      if (name === "jump") {
        const op = emitJump(ctx, call);
        return op === undefined ? [] : [op];
      }
      if (name === "staticFor") {
        return emitStaticFor(ctx, call);
      }
      if (name === "cell") {
        diag(ctx, call, "cell 是构建期声明词，只能用于模块层 const，不能作为命令");
        return [];
      }
      const args = call.arguments.map((arg) => evaluateWordArg(ctx, arg));
      const op = callWord(ctx, call, name, args);
      return op === undefined ? [] : [op];
    }
    if (binding.kind === "function") {
      const op = emitCallCommand(ctx, call, name);
      return op === undefined ? [] : [op];
    }
    if (binding.kind === "declare" && name === "jump") {
      const op = emitJump(ctx, call);
      return op === undefined ? [] : [op];
    }
    diag(ctx, call, `\`${name}\` 是 ${binding.kind} 绑定，不是可发射的命令`);
    return [];
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const target = lookupBinding(ctx, callee.expression.text);
    if (target?.kind === "namespace") {
      const args = call.arguments.map((arg) => evaluateWordArg(ctx, arg));
      const op = callWord(ctx, call, callee.name.text, args);
      return op === undefined ? [] : [op];
    }
    diag(ctx, call, "方法调用不支持：词函数通过具名导入或 script 命名空间调用");
    return [];
  }
  diag(ctx, call, "命令只能是词函数/函数调用");
  return [];
}

// —— 赋值 ——
