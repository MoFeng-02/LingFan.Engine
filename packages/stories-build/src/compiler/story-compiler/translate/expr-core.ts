import * as ts from "typescript";
import { evaluateExpression } from "@lingfan/engine";
import { diag, lookupBinding, lookupScope } from "./shared";
import type { BodyCtx } from "./shared";

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

const probeCache = new Set<string>();

/** 探针免检前缀：路径型内建的实参由编译器构造性生成（文法必然合法），运行期语义不归探针管 */
const PROBE_LENIENT = /^(arrayGet|dictGet|optGet|len)\(/;

export function probeExpression(src: string): boolean {
  if (probeCache.has(src) || PROBE_LENIENT.test(src)) return true;
  try {
    evaluateExpression(src, () => ({ found: true as const, value: 1 }));
    probeCache.add(src);
    return true;
  } catch {
    return false;
  }
}

export function quoteEngineString(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function engineValueText(value: string | number | boolean): string {
  return typeof value === "string" ? quoteEngineString(value) : String(value);
}

const PRECEDENCE: Record<string, number> = {
  "||": 2,
  "??": 1,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

function wrapOperand(
  child: string,
  childPrec: number,
  parentPrec: number,
): string {
  return childPrec < parentPrec ? `(${child})` : child;
}

export interface StatePath {
  /** 根名剥离后的点路径（如 state.player.gold → "player.gold"） */
  path: string;
  /** 链上存在 `?.`（可选段）；值位置会脱糖为 optGet，写位置/for-of 集合不支持 */
  optional: boolean;
}

export function statePath(
  ctx: BodyCtx,
  expr: ts.Expression,
): StatePath | undefined {
  const root = ctx.shared.stateRoot;
  const parts: string[] = [];
  let cur: ts.Expression = expr;
  let optional = false;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) {
      if (cur.questionDotToken !== undefined) optional = true;
      parts.unshift(cur.name.text);
      cur = cur.expression;
      continue;
    }
    if (ts.isIdentifier(cur) && cur.text === root) {
      if (parts.length === 0) {
        diag(ctx, expr, `${root} 必须以成员路径使用：${root}.player.gold`);
        return undefined;
      }
      return { path: parts.join("."), optional };
    }
    diag(
      ctx,
      expr,
      `成员表达式只支持 ${root} 路径（如 ${root}.player.gold）或枚举成员访问`,
    );
    return undefined;
  }
}

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

const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

/** 两侧均为数字字面量的算术二元式在构建期折叠成单值（除/模零不折叠，留给运行期文法校验）。 */
function foldNumericBinary(
  left: string,
  right: string,
  op: string,
): string | undefined {
  if (!NUMERIC_TEXT.test(left) || !NUMERIC_TEXT.test(right)) return undefined;
  const a = Number(left);
  const b = Number(right);
  switch (op) {
    case "+":
      return String(a + b);
    case "-":
      return String(a - b);
    case "*":
      return String(a * b);
    case "/":
      return b === 0 ? undefined : String(a / b);
    case "%":
      return b === 0 ? undefined : String(a % b);
    default:
      return undefined;
  }
}
