/**
 * 引擎包公共出口：UI/适配器只允许从这里 import（模块单一公共入口）。
 *
 * 内部按功能域归类，每个域有自己的出口，包出口只转发这些出口：
 * `contracts/`（契约，全量转发）、`runtime/index.ts`（执行器与运行期支撑）、
 * `data/index.ts`（故事文件解析·工程组装·文本投影·元素装载）。
 * 包出口不逐个深入实现文件；域内零件（`runtime/scope`、`runtime/resolver` 等）不经这里暴露。
 */
export * from "./contracts";
/**
 * 运行层：执行器与运行期支撑 —— 宿主信息解析、文本国际化、玩家偏好、壳配置解析、写入契约守卫、
 * op 注册表、等待声明表、声明制扩展装载、表达式求值。
 *
 * 三条「单一事实源」在这里成面，宿主与静态消费者一律从这里取，禁止各自复制：
 * - 壳配置解析（方向默认 / 层 z 表 / 存档壳）：契约与解析同在引擎；
 * - 等待声明表（`WAITING_OPS` / `waitingStateOfOp` / `waitSpecOfOp`）：哪个 op 建立等待点
 *   （= 检查点边界）的唯一判定依据，编辑器步骤视图等静态消费者据此切分，与运行时的一致性
 *   由行为互锁测试守护；
 * - 写入契约守卫（`jsonUnsafeReason` / `findJsonValueError`）：宿主、扩展与测试模板写入前断言共用。
 *
 * 表达式求值（`evaluateExpression` / `interpolateText` / `ExpressionError` / `NameResolver`）
 * 同属执行期语义，编辑器侧的构建期校验与它逐条互锁，故一并公开。
 *
 * 状态读口（`createStateReader`）是界面读系统键的唯一带类型入口：形状校验与畸形载荷
 * 降级都在引擎侧成面，界面不再各写一份；通用读口 `StoryEngine.get` 原样保留。
 */
export {
  BUILTIN_OP_NAMES,
  buildOpRegistry,
  collectTextProjections,
  createStateReader,
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  evaluateExpression,
  ExpressionError,
  findJsonValueError,
  INSTANCE_Z_KEYS,
  instanceZLayer,
  interpolateText,
  isValidSayColor,
  jsonUnsafeReason,
  LAYER_IDS,
  loadDeclaredExtensions,
  manifestOrientation,
  mergeOverlayFiles,
  PlayerPreferences,
  resolveHost,
  resolveInstanceZ,
  resolveLayerZ,
  resolveOrientationMode,
  resolveSavesConfig,
  slotIds,
  StoryEngine,
  WAITING_OPS,
  waitSpecOfOp,
  waitingStateOfOp,
  type EngineOptions,
  type ExtensionModuleLoader,
  type GuardContext,
  type GuardFn,
  type LayerId,
  type LayerZOverrides,
  type LayerZTable,
  type NameResolver,
  type SavesConfig,
  type SavesThumbnailConfig,
} from "./runtime";
/**
 * 数据层：故事文件解析（JSON v1 / `.story` 混存）、工程组装与写回、文本投影（双向）、
 * 元素形状校验与装载。两条「单一事实源」在这里成面：
 * - 工程写回（`assembleProject` 的逆函数）：Story + 原始清单 → 期望文件全集与最小差量，
 *   编辑器保存经此（格式知识单点，禁在适配器复制）；
 * - 元素形状校验：编辑器编辑期与运行期**同口径**。
 * 元素装载与寻址（`loadElements` / `findElements` / `removeElements`）是同一套元素形状知识的
 * 消费口，与校验函数一同公开，避免调用方另写一份结构假设。
 * 文本投影警告（`drainTextProjectionWarnings`）取走并清空最近一次解析的警告：解析本身不因
 * 「语义暂未生效」失败，但这些警告不能丢，故给调用方一个显式取口。
 */
export {
  assembleProject,
  baseName,
  conflictMessage,
  detectWriteConflicts,
  detectWriteNormalization,
  diffProjectFiles,
  drainTextProjectionWarnings,
  findElements,
  generateText,
  isSafeFileNameSegment,
  isSingleColumnFile,
  loadElements,
  MANIFEST_FILE,
  parseStory,
  parseStoryFile,
  parseTextStory,
  ProjectAssemblyError,
  ProjectSerializationError,
  projectText,
  removeElements,
  serializeColumnDocument,
  serializeProject,
  STORIES_DIR,
  StoryFormatError,
  synthesizeDegradedManifest,
  TextFormatError,
  validateElement,
  validateElementNode,
  type FileStamp,
  type ProjectFileDiff,
  type SerializedProject,
  type TextProjection,
  type WriteNormalizationFinding,
} from "./data";
