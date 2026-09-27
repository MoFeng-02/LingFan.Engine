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
/**
 * 09-16 工程写回（`assembleProject` 的逆函数）：Story + 原始清单 → 期望文件全集，
 * 以及与打开基线的最小差量。编辑器保存经此（格式知识单点，禁在适配器复制）。
 */
export {
  diffProjectFiles,
  isSafeFileNameSegment,
  MANIFEST_FILE,
  ProjectSerializationError,
  serializeProject,
  STORIES_DIR,
  type ProjectFileDiff,
  type SerializedProject,
} from "./data";
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
/**
 * 壳配置解析（⑨-6 方向默认 / ⑨-11 层 z 表 / ⑨-12 存档壳）：**契约与解析同在引擎**，
 * 所有宿主（playground / 模板脚手架）一律从这里取，禁止各自复制（单一事实源）。
 */
export {
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  INSTANCE_Z_KEYS,
  instanceZLayer,
  LAYER_IDS,
  manifestOrientation,
  resolveInstanceZ,
  resolveLayerZ,
  resolveOrientationMode,
  resolveSavesConfig,
  slotIds,
  type LayerId,
  type LayerZOverrides,
  type LayerZTable,
  type SavesConfig,
  type SavesThumbnailConfig,
} from "./runtime/shell";
/** 08 §二.1 元素形状校验（F5）：编辑器编辑期与运行期**同口径**的单一事实源 */
export { validateElement, validateElementNode } from "./data";
