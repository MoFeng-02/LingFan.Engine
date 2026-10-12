/**
 * 编译期求值域：node_modules 值导入与状态初始声明的常量折叠。
 *
 * `const-eval` 起 worker 隔离求值（并注入 define/defineVars 构建期内建），
 * `const-eval-pass` 按模块筛出待求值的导出喂进去，`config-eval` 用同一通道
 * 单次求值 config.ts 四导出（folders/start/vars/state + define 累积），
 * `state-schema` 把形态 A/B 的状态树走同一降维文法扁平化为 defines——
 * 四者是同一件事的四段，分开就只剩互相调用的碎片。
 */
export {
  evalConstModule,
  type ConstEvalResult,
  type DefineCall,
  type DefineBad,
  type JsonValue,
} from "./const-eval";
export { formatConstDiagFile, runConstEvalPass } from "./const-eval-pass";
export { evalConfigModule, type ConfigEvalOutcome } from "./config-eval";
export { mergeDefineCalls, type DefineMergeResult } from "./define-merge";
export { runStateSchemaPass } from "./state-schema";
