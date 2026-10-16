/**
 * 语句族出口：TS 语句（含控制流）到引擎语句的翻译。
 *
 * 轴 = 语句层两件——语句分派（`statements.ts`）与控制流块（`control-flow.ts`，
 * 块体递归入口由调用方以 `StatementDispatch` 注入）。
 */
export {
  translateBlockBody,
  translateFor,
  translateForOf,
  translateIf,
  translateSwitch,
  translateWhile,
} from "./control-flow.ts";
export type { StatementDispatch } from "./control-flow.ts";
export { translateStatement, translateStatements } from "./statements.ts";
