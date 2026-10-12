/**
 * 编译期求值域：node_modules 值导入与状态 schema 的常量折叠。
 *
 * `const-eval` 起 worker 隔离求值，`const-eval-pass` 按模块筛出待求值的
 * 导出喂进去，`state-schema` 借同一条求值通道拿 `lib/state.ts` 的默认值——
 * 三者是同一件事的三段，分开就只剩互相调用的碎片。
 */
export {
  evalConstModule,
  type ConstEvalResult,
  type JsonValue,
} from "./const-eval";
export { formatConstDiagFile, runConstEvalPass } from "./const-eval-pass";
export { runStateSchemaPass, STATE_SCHEMA_REL } from "./state-schema";
