import type * as ts from "typescript";
import type { StoryCommand } from "@lingfan-engine/core";
import type { BodyCtx } from "../../shared.ts";

/**
 * 词命令递归入口：命令发射总入口由 `command.ts` 注入给实参求值（`arg.ts`）与
 * staticFor 展开（`static-for.ts`）。
 *
 * 值位置的词调用（`option(...)`）与 staticFor 生成器元素都要回到命令发射总入口，
 * 而总入口又要靠实参求值 ⇒ 两处若直接 import `command.ts` 即成环（环判据白名单为空）。
 * 与 `stmt/control-flow.ts` 的 `StatementDispatch` 同法：**只注入、不反向 import**。
 */
export interface WordDispatch {
  /** 调用表达式 → 命令序列（staticFor 的展开点已扁平化） */
  command(ctx: BodyCtx, call: ts.CallExpression): StoryCommand[];
}
