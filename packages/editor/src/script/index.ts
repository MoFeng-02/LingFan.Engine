/**
 * Script 词汇层 · 出口（全量 op 覆盖 + 复合词 + 表达式句柄）。
 *
 * **SCRIPT_COVERAGE = builder ↔ op 双射的机器可读面**——生成物（./vocabulary.g.ts，
 * 由 generate-vocabulary.ts 重建，勿手改）：直接词条来自 words 源返回注解扫描，
 * 辅助词走显式补充表，注册表键集快照同步入内。改注册表/词条后未重建 =
 * tests/editor/script-vocabulary.test.ts 的生成物新鲜度用例红。
 * `$` 前缀 = 辅助词（不直接产出独立 op）——互锁比较时跳过。
 */

// —— 词汇层主体：词函数 + 注册表 + 句柄 + 命令类型（单一声明在 core）——
// editor 出口是转发面：经链取到同一函数对象与类型声明，故事源 import 不变。
export * from "@lingfan-engine/core/script";

// —— 表达式句柄 ——
export {
  defineVars,
  expr,
  cond,
  drainExpressionWarnings,
  type VarKind,
  type VarHandle,
  type VarTree,
  type ExpressionWarning,
} from "./expr/index.ts";

// —— 编译期构造（仅 Stories.src 源内可用，运行期不提供实现）——
export { staticFor, type StoryFn } from "./compile-time.ts";

export {
  SCRIPT_COVERAGE,
  VOCABULARY_OPS,
  type VocabularyOp,
} from "./vocabulary.g.ts";