import * as ts from "typescript";
import { diag, lookupBinding } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import { lowerValue, loweredToScriptValue } from "../expr.ts";
import { wordCalleeName } from "./callee.ts";
import type { WordDispatch } from "./dispatch.ts";

// —— 词实参求值（静态求值 + 嵌套命令递归）——

export function evaluateWordArg(
  ctx: BodyCtx,
  expr: ts.Expression,
  dispatch: WordDispatch,
): unknown {
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
    // UI 句柄作词实参时就是它的名字（`mount(hub, true)` 的 `hub`），
    // 与句柄在其他位置被折叠成字符串是同一件事。
    if (binding?.kind === "ui") {
      return { name: binding.name };
    }
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const out: unknown[] = [];
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el)) {
        diag(ctx, el, "展开实参不支持");
        return undefined;
      }
      const item = evaluateWordArg(ctx, el, dispatch);
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
      const value = evaluateWordArg(ctx, prop.initializer, dispatch);
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
      const ops = dispatch.command(ctx, expr);
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
