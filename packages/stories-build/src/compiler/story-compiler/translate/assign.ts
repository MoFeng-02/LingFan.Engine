import * as ts from "typescript";
import type { StoryCommand } from "@lingfan/engine";
import {
  diag,
  lookupBinding,
  lookupScope,
  lookupOwnScope,
  declareLocal,
} from "./shared";
import type { BodyCtx } from "./shared";
import { statePath } from "./expr-core";
import { lowerValue, loweredToScriptValue } from "./expr";
import { callWord, emitCallCommand, resolveFunctionCallee } from "./words";

function assignmentTarget(
  ctx: BodyCtx,
  expr: ts.Expression,
):
  | { kind: "local"; name: string }
  | { kind: "state"; path: string }
  | undefined {
  if (ts.isIdentifier(expr)) {
    if (expr.text === ctx.shared.stateRoot) {
      diag(
        ctx,
        expr,
        `${ctx.shared.stateRoot} 必须以成员路径使用：${ctx.shared.stateRoot}.gold`,
      );
      return undefined;
    }
    const own = lookupOwnScope(ctx, expr.text);
    if (own !== undefined) {
      if (own.kind !== "let" && own.kind !== "param") {
        diag(
          ctx,
          expr,
          `赋值目标 \`${expr.text}\` 必须是已声明的 let 局部变量`,
        );
        return undefined;
      }
      return { kind: "local", name: expr.text };
    }
    if (lookupScope(ctx, expr.text) !== undefined) {
      // 运行时 letVar 只声明进当前函数帧（外层变量原样不动），跨层赋值必然是假写入 → 构建期拦截
      diag(
        ctx,
        expr,
        `不能在内层函数给外层变量 \`${expr.text}\` 赋值：内层赋值只会声明内层新变量，不会写回外层`,
      );
      return undefined;
    }
    diag(ctx, expr, `赋值目标 \`${expr.text}\` 必须是已声明的 let 局部变量`);
    return undefined;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const target = statePath(ctx, expr);
    if (target === undefined) return undefined;
    if (target.optional) {
      // 写位置不允许缺失语义（optGet 只读），fail-closed
      diag(ctx, expr, `赋值目标不支持可选链：${target.path}`);
      return undefined;
    }
    return { kind: "state", path: target.path };
  }
  diag(
    ctx,
    expr,
    `赋值目标只能是 let 局部变量或 ${ctx.shared.stateRoot} 单层路径`,
  );
  return undefined;
}

function compoundValue(
  ctx: BodyCtx,
  node: ts.Node,
  op: string,
  rhs: ts.Expression,
): string | undefined {
  const lowered = lowerValue(ctx, rhs);
  if (lowered === undefined) return undefined;
  if (lowered.kind === "lit" && typeof lowered.value !== "number") {
    diag(ctx, node, "复合赋值右侧必须是数值");
    return undefined;
  }
  const rhsText = lowered.kind === "lit" ? String(lowered.value) : lowered.text;
  return `${op} {${rhsText}}`;
}

export function emitAssignment(
  ctx: BodyCtx,
  node: ts.Node,
  target: ts.Expression,
  op: string,
  rhs: ts.Expression,
): StoryCommand[] {
  const resolved = assignmentTarget(ctx, target);
  if (resolved === undefined) return [];
  const word = resolved.kind === "state" ? "set" : "letVar";
  const key = resolved.kind === "state" ? resolved.path : resolved.name;
  let value: string | number | boolean;
  if (op === "=") {
    const lowered = lowerValue(ctx, rhs);
    if (lowered === undefined) return [];
    value = loweredToScriptValue(lowered);
  } else {
    const compound = compoundValue(ctx, node, op, rhs);
    if (compound === undefined) return [];
    value = compound;
  }
  const op2 = callWord(ctx, node, word, [key, value]);
  return op2 === undefined ? [] : [op2];
}

export function translateIncrement(
  ctx: BodyCtx,
  expr: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
): StoryCommand[] {
  const op =
    expr.operator === ts.SyntaxKind.PlusPlusToken
      ? "+="
      : expr.operator === ts.SyntaxKind.MinusMinusToken
        ? "-="
        : undefined;
  if (op === undefined) {
    diag(ctx, expr, "自增/自减只支持 ++ 与 --");
    return [];
  }
  return emitAssignment(
    ctx,
    expr,
    expr.operand,
    op,
    ts.factory.createNumericLiteral("1"),
  );
}

// —— 语句转译 ——

export function translateVariableStatement(
  ctx: BodyCtx,
  stmt: ts.VariableStatement,
): StoryCommand[] {
  const out: StoryCommand[] = [];
  for (const decl of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) {
      diag(ctx, decl, "解构声明不支持：数组请用 newArray 词、对象请用 dict 词");
      continue;
    }
    if (decl.initializer === undefined) {
      diag(ctx, decl, "局部变量声明必须带初始化（引擎没有未初始化的槽位）");
      continue;
    }
    if (ts.isArrayLiteralExpression(decl.initializer)) {
      diag(ctx, decl.initializer, "数组字面量不支持：请用 newArray 词");
      continue;
    }
    if (ts.isObjectLiteralExpression(decl.initializer)) {
      diag(ctx, decl.initializer, "对象字面量不支持：请用 dict 词");
      continue;
    }
    // 语句级 `const x = f(1)` / `let x = f(1)`：子程序调用的**唯一**取值形态——
    // 降级为 `call into`（结果绑定名），引擎把返回值声明成本地变量。表达式位
    // （say 插值、赋值右值）仍拒绝：求值是命令内同步一步，中途不能挂起等 call 返回。
    if (ts.isCallExpression(decl.initializer)) {
      const fn = resolveFunctionCallee(ctx, decl.initializer);
      if (fn !== undefined) {
        const op = emitCallCommand(ctx, decl.initializer, fn, decl.name.text);
        if (op !== undefined) out.push(op);
        // 声明放在发射之后：实参在当前作用域里求值，不读这个新名字
        declareLocal(ctx, decl.name.text, { kind: "let" });
        continue;
      }
      // 未解析的具名 callee：与命令位同文案。值位置那句「请用语句级 const x = f(1)」
      // 对已经在语句级的写法是错误指路，这里必须报出真实病因
      if (ts.isIdentifier(decl.initializer.expression)) {
        const calleeName = decl.initializer.expression.text;
        if (
          lookupBinding(ctx, calleeName) === undefined &&
          lookupScope(ctx, calleeName) === undefined
        ) {
          diag(
            ctx,
            decl.initializer,
            `未知调用目标 \`${calleeName}\`（须是词函数或声明的函数）`,
          );
          continue;
        }
      }
    }
    const lowered = lowerValue(ctx, decl.initializer);
    if (lowered === undefined) continue;
    declareLocal(ctx, decl.name.text, { kind: "let" });
    const op = callWord(ctx, decl, "letVar", [
      decl.name.text,
      loweredToScriptValue(lowered),
    ]);
    if (op !== undefined) out.push(op);
  }
  return out;
}
