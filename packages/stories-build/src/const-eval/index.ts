/**
 * 编译期求值域：node_modules 值导入与状态初始声明的常量折叠。
 *
 * `const-eval` 起 worker 隔离求值（并注入 define/defineVars 构建期内建），
 * `const-eval-pass` 按模块筛出待求值的导出喂进去，`config-eval` 用同一通道
 * 单次求值 config.ts 四导出（folders/start/vars/state + define 累积），
 * `const-expr`/`module-define` 用 AST 折叠模块层构建期 define（界面规范 对应章节
 * define 域），`define-merge` 把各源汇入同一棵合并树，`state-schema` 把形态
 * A/B 的状态树走同一降维文法扁平化为 defines——各段是同一件事的分步，
 * 分开就只剩互相调用的碎片。
 */
export {
  evalConstModule,
  type ConstEvalResult,
  type DefineCall,
  type DefineBad,
  type JsonValue,
} from "./const-eval";
export { formatConstDiagFile, runConstEvalPass } from "./const-eval-pass";
export { evalConstExpr, type ConstExprContext, type ConstExprResult } from "./const-expr";
export { collectModuleDefines, type LocatedDefineCall } from "./module-define";
export { evalConfigModule, type ConfigEvalOutcome } from "./config-eval";
export {
  mergeDefineCalls,
  mergeDefineCallsInto,
  type DefineMergeResult,
  type OriginatedDefineCall,
} from "./define-merge";
export { runStateSchemaPass } from "./state-schema";
