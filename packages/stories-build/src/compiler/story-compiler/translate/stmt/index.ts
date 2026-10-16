/**
 * 语句族出口：TS 语句（含控制流）到引擎语句的翻译。
 *
 * 轴 = 语句层两件——语句分派（`statements.ts`）与控制流族（`control-flow.ts`
 * 提供块体递归入口契约 `StatementDispatch` 与 `translateBlockBody`，
 * `control/` 子目录按 if / 循环 / 迭代 / switch 分文件实现）。
 */
export { translateBlockBody } from "./control-flow.ts";
export type { StatementDispatch } from "./control-flow.ts";
export {
  translateFor,
  translateForOf,
  translateIf,
  translateSwitch,
  translateWhile,
} from "./control/index.ts";
export { translateStatement, translateStatements } from "./statements.ts";
