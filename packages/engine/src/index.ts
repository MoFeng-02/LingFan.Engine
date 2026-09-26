/**
 * 引擎包公共出口：UI/适配器只允许从这里 import（模块单一公共入口，宪法 §3）。
 * 内部按功能域归类：contracts（契约）/ data（01 数据层：解析·组装·文本投影）/ runtime（02-04 执行·回溯·作用域）。
 */
export * from "./contracts";
export { StoryEngine } from "./runtime/engine";
export {
  baseName,
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./data";
export { assembleProject, ProjectAssemblyError } from "./data";
export {
  generateText,
  parseTextStory,
  projectText,
  TextFormatError,
  type TextProjection,
} from "./data";
export { resolveHost } from "./runtime/host";
export { mergeOverlayFiles } from "./runtime/i18n";
export { PlayerPreferences } from "./runtime/preferences";
/** 08 §二.1 元素形状校验（F5）：编辑器编辑期与运行期**同口径**的单一事实源 */
export { validateElement, validateElementNode } from "./data";
