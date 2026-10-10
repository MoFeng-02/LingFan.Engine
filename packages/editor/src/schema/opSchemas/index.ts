/**
 * op 全集 schema（Zod 单一事实源）：一份定义同时驱动属性面板表单派生与
 * 编辑期 fail-closed 校验。字段面以执行器为权威（packages/engine/src/runtime/ops/）：
 * 未知 op / 未知负载字段 / 缺失必填 / 类型错误在编辑期标红，错误不过夜。
 * 块体字段（then/body/…）按 z.unknown() 数组承载——嵌套命令的校验与指针定位由
 * validateStory 沿表单描述符递归（嵌套命令才拿得到逐条 unknown-op 诊断）。
 */
export { OP_SCHEMAS } from "./map";
export type {
  ScriptOpName,
  CommandOf,
  ScriptCommand,
  ScriptValue,
} from "./types";
export { validateCommand } from "./validate";
