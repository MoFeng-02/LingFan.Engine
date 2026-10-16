/**
 * 表达式降级主分发：把 TS 表达式逐个形态降成引擎表达式文本 + 优先级。
 *
 * 白名单外的形态一律 `diag` 报诊断后返回 undefined（fail-closed，不做猜测性转换）；
 * 值位置不支持函数调用（词函数只能作为命令）。递归自调用，所以必须在同一文件内。
 */
import * as ts from "typescript";
import { diag, lookupBinding, lookupScope } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";
import { quoteEngineString, engineValueText } from "../engine-text.ts";
import { statePath } from "../state-path.ts";
import { PRECEDENCE, wrapOperand, foldNumericBinary } from "./numeric.ts";

const BUILTIN_EXPR_FNS = new Set([
  "random",
  "min",
  "max",
  "abs",
  "clamp",
  "arrayGet",
  "dictGet",
  "optGet",
  "len",
]);
/** 路径型内建：首参必须是路径字符串字面量（路径在构建期定型，不接受变量） */
const PATH_BUILTINS = new Set(["arrayGet", "dictGet", "optGet", "len"]);

export function lowerExpr(
  ctx: BodyCtx,
  expr: ts.Expression,
): { text: string; prec: number } | undefined {
  const sf = ctx.shared.mod.sf;
  const root = ctx.shared.stateRoot;
  if (ts.isNumericLiteral(expr)) {
    const n = Number(expr.text);
    if (!Number.isFinite(n)) {
      diag(ctx, expr, `数字字面量 \`${expr.text}\` 不是有限数`);
      return undefined;
    }
    return { text: String(n), prec: 9 };
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return { text: quoteEngineString(expr.text), prec: 9 };
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { text: "true", prec: 9 };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { text: "false", prec: 9 };
  if (ts.isParenthesizedExpression(expr)) {
    const inner = lowerExpr(ctx, expr.expression);
    return inner === undefined ? undefined : { text: inner.text, prec: 9 };
  }
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (name === root) {
      diag(ctx, expr, `${root} 必须以成员路径使用：${root}.player.gold`);
      return undefined;
    }
    const scoped = lookupScope(ctx, name);
    if (scoped !== undefined) {
      if (scoped.kind === "index") {
        return { text: String(scoped.value), prec: 9 };
      }
      if (scoped.kind === "function") {
        diag(ctx, expr, `函数 \`${name}\` 不能作为值`);
        return undefined;
      }
      return { text: name, prec: 9 };
    }
    const binding = lookupBinding(ctx, name);
    if (binding === undefined) {
      diag(
        ctx,
        expr,
        `未知标识符 \`${name}\`（未声明的 let、模块 const、枚举或词函数）`,
      );
      return undefined;
    }
    switch (binding.kind) {
      case "const": {
        const v = binding.value;
        if (v === null) {
          diag(ctx, expr, "常量值为 null，不可下沉到表达式");
          return undefined;
        }
        return { text: engineValueText(v), prec: 9 };
      }
      case "enum":
        diag(ctx, expr, `枚举 \`${name}\` 必须以成员形式使用：${name}.成员`);
        return undefined;
      default:
        diag(
          ctx,
          expr,
          `\`${name}\` 不能用于表达式（${binding.kind} 绑定不可求值）`,
        );
        return undefined;
    }
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
          diag(ctx, expr, "枚举成员值为 null，不可下沉到表达式");
          return undefined;
        }
        return { text: engineValueText(value), prec: 9 };
      }
    }
    const target = statePath(ctx, expr);
    if (target === undefined) return undefined;
    // 可选段脱糖：state.player?.nick → optGet("player.nick")（路径缺失返回 null，配 ?? 兜底）
    if (target.optional) {
      return { text: `optGet(${quoteEngineString(target.path)})`, prec: 9 };
    }
    return { text: target.path, prec: 9 };
  }
  if (ts.isElementAccessExpression(expr)) {
    const target = statePath(ctx, expr.expression);
    if (target === undefined) return undefined;
    // `?.[` 不支持：内建缺失语义（null）已覆盖可选需求，不再叠加可选层
    if (expr.questionDotToken !== undefined || target.optional) {
      diag(ctx, expr, `${root} 下标访问不支持可选链 ?.[]`);
      return undefined;
    }
    const arg = expr.argumentExpression;
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return {
        text: `dictGet(${quoteEngineString(target.path)}, ${quoteEngineString(arg.text)})`,
        prec: 9,
      };
    }
    const index = lowerExpr(ctx, arg);
    if (index === undefined) return undefined;
    return {
      text: `arrayGet(${quoteEngineString(target.path)}, ${index.text})`,
      prec: 9,
    };
  }
  if (ts.isPrefixUnaryExpression(expr)) {
    const opText =
      expr.operator === ts.SyntaxKind.ExclamationToken
        ? "!"
        : expr.operator === ts.SyntaxKind.MinusToken
          ? "-"
          : undefined;
    if (opText === undefined) {
      diag(ctx, expr, "一元表达式只支持 ! 与 -（自增自减只能作为独立语句）");
      return undefined;
    }
    const operand = lowerExpr(ctx, expr.operand);
    if (operand === undefined) return undefined;
    return {
      text: opText + wrapOperand(operand.text, operand.prec, 8),
      prec: 8,
    };
  }
  if (ts.isBinaryExpression(expr)) {
    const raw = expr.operatorToken.getText(sf);
    const op = raw === "===" ? "==" : raw === "!==" ? "!=" : raw;
    const prec = PRECEDENCE[op];
    if (prec === undefined) {
      diag(ctx, expr, `二元运算符 \`${raw}\` 不在引擎表达式文法内`);
      return undefined;
    }
    const left = lowerExpr(ctx, expr.left);
    const right = lowerExpr(ctx, expr.right);
    if (left === undefined || right === undefined) return undefined;
    const folded = foldNumericBinary(left.text, right.text, op);
    if (folded !== undefined) return { text: folded, prec: 9 };
    return {
      text: `${wrapOperand(left.text, left.prec, prec)} ${op} ${wrapOperand(right.text, right.prec, prec + 1)}`,
      prec,
    };
  }
  if (ts.isConditionalExpression(expr)) {
    const cond = lowerExpr(ctx, expr.condition);
    const whenTrue = lowerExpr(ctx, expr.whenTrue);
    const whenFalse = lowerExpr(ctx, expr.whenFalse);
    if (cond === undefined || whenTrue === undefined || whenFalse === undefined)
      return undefined;
    return {
      text: `${wrapOperand(cond.text, cond.prec, 1)} ? ${wrapOperand(whenTrue.text, whenTrue.prec, 2)} : ${wrapOperand(whenFalse.text, whenFalse.prec, 1)}`,
      prec: 1,
    };
  }
  if (ts.isCallExpression(expr)) {
    if (
      ts.isIdentifier(expr.expression) &&
      lookupBinding(ctx, expr.expression.text) === undefined &&
      BUILTIN_EXPR_FNS.has(expr.expression.text)
    ) {
      const fnName = expr.expression.text;
      const args: string[] = [];
      if (PATH_BUILTINS.has(fnName)) {
        // 路径型内建首参在构建期定型：state 路径降级成路径串，或直接写字符串字面量；
        // let 变量等运行期值当路径无法进快照 ⇒ fail-closed
        const first = expr.arguments[0];
        const asPath =
          first !== undefined && ts.isPropertyAccessExpression(first)
            ? statePath(ctx, first)
            : undefined;
        let firstText: string | undefined;
        if (asPath !== undefined) {
          if (asPath.optional) {
            diag(ctx, first!, `${fnName} 路径不支持可选链`);
            return undefined;
          }
          firstText = quoteEngineString(asPath.path);
        } else if (
          first !== undefined &&
          (ts.isStringLiteral(first) ||
            ts.isNoSubstitutionTemplateLiteral(first))
        ) {
          firstText = quoteEngineString(first.text);
        } else {
          diag(
            ctx,
            expr,
            `${fnName} 首参必须是路径（${root} 路径或字符串字面量）`,
          );
          return undefined;
        }
        args.push(firstText);
        for (const arg of expr.arguments.slice(1)) {
          const lowered = lowerExpr(ctx, arg);
          if (lowered === undefined) return undefined;
          args.push(lowered.text);
        }
        return { text: `${fnName}(${args.join(", ")})`, prec: 9 };
      }
      for (const arg of expr.arguments) {
        const lowered = lowerExpr(ctx, arg);
        if (lowered === undefined) return undefined;
        args.push(lowered.text);
      }
      return { text: `${fnName}(${args.join(", ")})`, prec: 9 };
    }
    diag(
      ctx,
      expr,
      "值位置的函数调用不支持：词函数只能作为命令，子程序返回值请用语句级 `const x = f(1)`（call into 结果通道），表达式内建函数仅 random/min/max/abs/clamp/arrayGet/dictGet/optGet/len",
    );
    return undefined;
  }
  if (ts.isTemplateExpression(expr)) {
    diag(
      ctx,
      expr,
      "模板串只能作为字符串值（say 文本等），不能用于条件/算术表达式",
    );
    return undefined;
  }
  diag(ctx, expr, "表达式不在引擎文法白名单内（TS-only 结构不支持）");
  return undefined;
}
