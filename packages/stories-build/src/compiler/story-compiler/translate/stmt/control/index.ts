/**
 * 控制流族出口：if / while / for / for-of / switch 的翻译入口。
 *
 * 族内各文件共用 `StatementDispatch` 契约（注入式递归入口，声明在
 * `../control-flow.ts`），并统一从 `../control-flow.ts` 取 `translateBlockBody`
 * 下探块体——单向依赖，不反向 import 语句分发器（`statements.ts`）。
 */
export { translateIf } from "./branch.ts";
export { translateFor, translateWhile } from "./loop.ts";
export { translateForOf } from "./iter.ts";
export { translateSwitch } from "./switch.ts";
