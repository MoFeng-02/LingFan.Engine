/**
 * 诊断（编辑期）：符号索引 + 诊断集，全部带 JSON Pointer。
 * - 未定义变量：定义集 = defines + set/define/let/local/array/dict 键 + random.var +
 *   循环变量 + input.store（并集保守策略：let/local 块级精度为已知限界，不误报优先）；
 *   `_` 前缀豁免；行内标记白名单镜像执行器语义（已定义变量 > 行内标记）。
 * - 跳转目标不存在、未知函数、重复 columnId、入口列缺失、资源路径缺失、
 *   未使用翻译键（overlay 键 − 可翻译原文）、已声明但无渲染语义的元素属性。
 *
 * 实现分布：表达式引用抽取在 ./refs，符号索引在 ./symbols，分析入口在 ./analyze
 * ——本文件只做转发，不承载实现。
 */
export { extractExpressionRefs } from "./refs";
export { indexStory } from "./symbols";
export { analyzeStory } from "./analyze";
export type { AnalyzeOptions } from "../contracts";

/**
 * 诊断集的分组与摘要（可按严重度筛选），以及消息文本的拆分与一句话简述。
 * 两族住在同域的其他文件里，此处一并转发，让本目录只有一个取用入口。
 */
export {
  diagnosticCodeLabel,
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  summarizeDiagnostics,
  type DiagnosticGroup,
  type DiagnosticSummary,
  type SeverityFilter,
} from "./grouping";
export {
  diagnosticBrief,
  splitDiagnosticMessage,
  type DiagnosticMessageParts,
} from "./message";
