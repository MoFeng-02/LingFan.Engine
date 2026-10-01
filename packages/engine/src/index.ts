/**
 * 引擎包公共出口：UI/适配器只允许从这里 import（模块单一公共入口）。
 * 内部按功能域归类：contracts（契约）/ data（数据层：解析·组装·文本投影）/ runtime（执行·回溯·作用域）。
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
 * 工程写回（`assembleProject` 的逆函数）：Story + 原始清单 → 期望文件全集，
 * 以及与打开基线的最小差量。编辑器保存经此（格式知识单点，禁在适配器复制）。
 * 并发修改检测：文件指纹比对（冲突以错误出站）。
 * 规范化检测：保存前列出「打开形态 → 标准布局」的动作。
 */
export {
  conflictMessage,
  detectWriteConflicts,
  detectWriteNormalization,
  diffProjectFiles,
  isSafeFileNameSegment,
  MANIFEST_FILE,
  ProjectSerializationError,
  serializeProject,
  STORIES_DIR,
  type FileStamp,
  type ProjectFileDiff,
  type SerializedProject,
  type WriteNormalizationFinding,
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
 * 壳配置解析（方向默认 / 层 z 表 / 存档壳）：**契约与解析同在引擎**，
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
/** 元素形状校验：编辑器编辑期与运行期**同口径**的单一事实源 */
export { validateElement, validateElementNode } from "./data";
/**
 * 写入契约守卫（值侧）：宿主/扩展与测试模板可用同一函数做**写入前断言**
 * （"断言工具"是「原地改可变值」的兜底手段之一）。
 */
export {
  findJsonValueError,
  jsonUnsafeReason,
} from "./runtime/stateContract";
export {
  BUILTIN_OP_NAMES,
  buildOpRegistry,
  collectTextProjections,
  isExtensionStateKey,
  type RegisteredOp,
} from "./runtime/opRegistry";
/**
 * 等待声明表：哪个 op 建立等待点（= 检查点边界）的单一事实源。
 * 静态消费者（编辑器步骤视图等）一律从这里取，禁止各自复制判定
 * （与运行时的一致性由行为互锁测试守护）。
 */
export {
  waitSpecOfOp,
  WAITING_OPS,
  waitingStateOfOp,
  type WaitSpec,
} from "./runtime/waitingOps";
/**
 * 声明制扩展装载：扫描器对未声明的扩展文件零感知；
 * 模块解析归宿主（注入式 import 回调），本模块只做形状校验（fail-closed）。
 */
export {
  loadDeclaredExtensions,
  type ExtensionModuleLoader,
} from "./runtime/extensionLoader";
