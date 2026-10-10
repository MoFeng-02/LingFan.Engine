/**
 * 表达式层出口：变量句柄、表达式标签与构建期警告。
 *
 * 实现按职责分文件——注册表与句柄、判类器、装配；消费方（`script/index.ts`）
 * 只从这里取。
 */

export {
  defineVars,
  drainExpressionWarnings,
  varKeyOf,
  type ExpressionWarning,
  type VarHandle,
  type VarKind,
  type VarTree,
} from "./registry";
export { cond, expr } from "./build";
