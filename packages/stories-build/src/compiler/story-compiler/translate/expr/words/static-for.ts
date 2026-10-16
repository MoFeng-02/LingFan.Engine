import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import { foldConst } from "../../../graph.ts";
import { diag, lookupBinding, lookupScope } from "../../shared.ts";
import type { BodyCtx, Scope } from "../../shared.ts";
import type { WordDispatch } from "./dispatch.ts";

const STATIC_FOR_MAX = 100000;

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

export function emitStaticFor(
  ctx: BodyCtx,
  call: ts.CallExpression,
  dispatch: WordDispatch,
): StoryCommand[] {
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
        out.push(...dispatch.command(ctx, element));
      }
    } finally {
      ctx.scopes.pop();
    }
  }
  return out;
}
