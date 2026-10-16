/**
 * state 成员表达式的路径归约：把 `state.a.b?.c` 收成引擎侧的点路径 + 可选段标记。
 *
 * 为什么单独一层：值降级（`lower/lower.ts`）与命令族（`assign.ts` / `stmt/control-flow.ts`）
 * 都要判「这是不是 state 路径」，判错就会把运行期值当构建期路径写进快照。
 */
import * as ts from "typescript";
import { diag } from "../shared.ts";
import type { BodyCtx } from "../shared.ts";

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
