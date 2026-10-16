import * as ts from "typescript";
import { lookupBinding, lookupScope } from "../../shared.ts";
import type { BodyCtx } from "../../shared.ts";

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
export function wordCalleeName(
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
