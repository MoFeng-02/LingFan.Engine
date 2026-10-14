import * as ts from "typescript";
import { diag, lookupBinding, lookupScope } from "./shared.ts";
import type { BodyCtx } from "./shared.ts";
import {
  probeExpression,
  lowerExpr,
  statePath,
  quoteEngineString,
} from "./expr-core.ts";

export type Lowered =
  | { kind: "lit"; value: string | number | boolean }
  | { kind: "expr"; text: string }
  | undefined;

export function lowerCond(
  ctx: BodyCtx,
  expr: ts.Expression,
): string | undefined {
  const inner = lowerExpr(ctx, expr);
  if (inner === undefined) return undefined;
  if (!probeExpression(inner.text)) {
    diag(ctx, expr, `表达式 \`${inner.text}\` 不符合引擎表达式文法`);
    return undefined;
  }
  return `{${inner.text}}`;
}

export function lowerValue(ctx: BodyCtx, expr: ts.Expression): Lowered {
  const root = ctx.shared.stateRoot;
  if (ts.isNumericLiteral(expr)) {
    const n = Number(expr.text);
    if (!Number.isFinite(n)) {
      diag(ctx, expr, `数字字面量 \`${expr.text}\` 不是有限数`);
      return undefined;
    }
    return { kind: "lit", value: n };
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { kind: "lit", value: expr.text };
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "lit", value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    diag(ctx, expr, "null 不可作为值");
    return undefined;
  }
  if (ts.isParenthesizedExpression(expr))
    return lowerValue(ctx, expr.expression);
  if (ts.isTemplateExpression(expr)) {
    const parts: string[] = [expr.head.text];
    for (const span of expr.templateSpans) {
      if (
        ts.isStringLiteral(span.expression) ||
        ts.isNoSubstitutionTemplateLiteral(span.expression)
      ) {
        parts.push(span.expression.text);
      } else if (
        span.expression.kind === ts.SyntaxKind.TrueKeyword ||
        span.expression.kind === ts.SyntaxKind.FalseKeyword
      ) {
        parts.push(
          span.expression.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false",
        );
      } else if (ts.isNumericLiteral(span.expression)) {
        parts.push(String(Number(span.expression.text)));
      } else {
        const lowered = lowerExpr(ctx, span.expression);
        if (lowered === undefined) return undefined;
        if (!probeExpression(lowered.text)) {
          diag(
            ctx,
            span.expression,
            `插值表达式 \`${lowered.text}\` 不符合引擎表达式文法`,
          );
          return undefined;
        }
        parts.push(`{${lowered.text}}`);
      }
      parts.push(span.literal.text);
    }
    return { kind: "lit", value: parts.join("") };
  }
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (name === root) {
      diag(ctx, expr, `${root} 必须以成员路径使用：${root}.player.gold`);
      return undefined;
    }
    const scoped = lookupScope(ctx, name);
    if (scoped !== undefined) {
      if (scoped.kind === "index")
        return { kind: "lit", value: scoped.value ?? 0 };
      return { kind: "expr", text: name };
    }
    const binding = lookupBinding(ctx, name);
    if (binding === undefined) {
      diag(ctx, expr, `未知标识符 \`${name}\``);
      return undefined;
    }
    if (binding.kind === "const") {
      if (binding.value === null) {
        diag(ctx, expr, "常量值为 null，不可作为值");
        return undefined;
      }
      return { kind: "lit", value: binding.value };
    }
    if (binding.kind === "enum") {
      diag(ctx, expr, `枚举 \`${name}\` 必须以成员形式使用：${name}.成员`);
      return undefined;
    }
    diag(ctx, expr, `\`${name}\` 不是值（${binding.kind} 绑定不能作为值）`);
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const object = expr.expression;
    if (ts.isIdentifier(object) && object.text !== root) {
      const binding = lookupBinding(ctx, object.text);
      if (binding?.kind === "enum") {
        const value = binding.members.get(expr.name.text);
        if (value === undefined) {
          diag(
            ctx,
            expr,
            `枚举 ${binding.name} 没有成员 \`${expr.name.text}\``,
          );
          return undefined;
        }
        if (value === null) {
          diag(ctx, expr, "枚举成员值为 null，不可作为值");
          return undefined;
        }
        return { kind: "lit", value };
      }
    }
    const target = statePath(ctx, expr);
    if (target === undefined) return undefined;
    // 可选段脱糖：state.player?.nick → optGet("player.nick")（路径缺失返回 null，配 ?? 兜底）
    if (target.optional) {
      return {
        kind: "expr",
        text: `optGet(${quoteEngineString(target.path)})`,
      };
    }
    return { kind: "expr", text: target.path };
  }
  if (
    ts.isBinaryExpression(expr) ||
    ts.isPrefixUnaryExpression(expr) ||
    ts.isConditionalExpression(expr) ||
    ts.isCallExpression(expr) ||
    ts.isElementAccessExpression(expr)
  ) {
    const lowered = lowerExpr(ctx, expr);
    if (lowered === undefined) return undefined;
    if (!probeExpression(lowered.text)) {
      diag(ctx, expr, `表达式 \`${lowered.text}\` 不符合引擎表达式文法`);
      return undefined;
    }
    return { kind: "expr", text: lowered.text };
  }
  diag(
    ctx,
    expr,
    "值表达式不支持此形态（数组请用 newArray 词、对象请用 dict 词）",
  );
  return undefined;
}

export function loweredToScriptValue(
  lowered: NonNullable<Lowered>,
): string | number | boolean {
  return lowered.kind === "lit" ? lowered.value : `{${lowered.text}}`;
}
