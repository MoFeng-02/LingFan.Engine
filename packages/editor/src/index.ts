/**
 * @lingfan-engine/editor 公共出口：op schema 单一事实源 + 编辑期诊断 +
 * 故事树纯映射器：只读写故事 JSON，不碰运行时与 Rust；
 * 作者视图偏好（列分组 / 折叠）走**注入式存储**、不入故事树。
 */

export type {
  AnalyzeOptions,
  ContainerField,
  ContainerInfo,
  Diagnostic,
  DiagnosticSeverity,
  FieldDescriptor,
  FieldKind,
  OpFormDescriptor,
  OpGroup,
  OpMeta,
  StoryListener,
  SymbolIndex,
  UndoEntry,
} from "./contracts/index.ts";
export { escapePointerToken, joinPointer } from "./contracts/index.ts";

export {
  coerceFieldValue,
  describeForm,
  describeNodeLabel,
  listOps,
} from "./schema/index.ts";
export {
  describeElement,
  elementLabel,
  listElementTypes,
  specificAttrsOf,
  UNIMPLEMENTED_ELEMENT_ATTRS,
  type ElementFormDescriptor,
} from "./schema/index.ts";
export {
  ELEMENT_TYPE_GROUPS,
  listOpGroups,
  OP_GROUP_LABELS,
  OP_GROUP_ORDER,
  type ElementTypeGroup,
  type OpGroupEntries,
} from "./schema/index.ts";
export { draggedPosition, parseNumericPosition } from "./element/index.ts";
export {
  createElementDraft,
  planElementDrop,
  type DropContainerHit,
  type ElementDropPlan,
} from "./element/index.ts";
export { OP_SCHEMAS, validateCommand } from "./schema/index.ts";
/**
 * 内建 op 判别联合（op 决定字段）+ 单 op 命令类型 + 标量值口径——
 * 全部派生自 op schema 单一事实源；词汇层 builder 返回与裸写命令注解共用。
 */
export type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
  ScriptValue,
} from "./schema/index.ts";
/** 词汇层构建期轻类型校验警告（expr/cond 组装时按引擎类型规则产出；drain 取走） */
export type { ExpressionWarning } from "./script/index.ts";
export {
  BUILTIN_OP_SURFACE,
  mergeOpMeta,
  mergeOpSchemas,
  mergeOpSurface,
  type OpSurface,
} from "./schema/index.ts";
export { validateStory } from "./schema/index.ts";
export {
  walkCommandBodies,
  walkStoryCommands,
  walkStoryElements,
} from "./schema/index.ts";

export { analyzeStory, extractExpressionRefs, indexStory } from "./diagnostics/index.ts";
export {
  diagnosticCodeLabel,
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  summarizeDiagnostics,
  type DiagnosticGroup,
  type DiagnosticSummary,
  type SeverityFilter,
} from "./diagnostics/index.ts";
export {
  diagnosticBrief,
  splitDiagnosticMessage,
  type DiagnosticMessageParts,
} from "./diagnostics/index.ts";
export {
  buildChapterIndex,
  chapterDirOf,
  chapterGroupOf,
  chapterLabelOf,
  chapterSummaryText,
  sceneTypeBadgeOf,
  type ChapterDir,
  type ChapterGroup,
  type ChapterIndex,
  type ChapterInput,
  type ChapterNode,
} from "./chapters/index.ts";

export {
  addTranslationRow,
  columnStoryKey,
  coverageLabelOf,
  coveragePercentOf,
  coverageWeightedPercentOf,
  coverageStateOf,
  extractStoryKeys,
  formatTranslationReport,
  groupKeysByStory,
  isTableDirty,
  langCoverage,
  parseTranslationTable,
  planOverlaySkeleton,
  reconcileTranslations,
  removeTranslationRow,
  renameTranslationRow,
  serializeTranslationTable,
  setTranslationValue,
  TRANSLATE_SURFACES,
  valuesAtPath,
  workbenchOverview,
  type CoverageState,
  type LangCoverage,
  type OverlaySkeletonFile,
  type SkeletonLayout,
  type SkeletonLayoutChoice,
  type SkeletonOptions,
  type SkeletonPlaceholder,
  type TableEdit,
  type TableParse,
  type TranslationReconcileReport,
  type TranslationRow,
  type WorkbenchOverview,
} from "./i18n/index.ts";

export {
  describeSelection,
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  nearestCommandPointer,
  removeAtPointer,
  setAtPointer,
  type SelectionDescription,
  type SelectionKind,
  type SelectionNodeKind,
} from "./editing/index.ts";
export {
  addColumn,
  columnContainers,
  containerPointer,
  firstColumnIdOfSourcePath,
  insertCommand,
  moveCommand,
  removeColumn,
  removeCommand,
  renameColumn,
  suggestColumnId,
  updateCommandField,
} from "./editing/index.ts";
export { EditorSession } from "./editing/index.ts";
export {
  branchPointerToCommand,
  isBranchTarget,
  planBranchInsertion,
  type BranchColumnLike,
  type BranchPlan,
} from "./editing/index.ts";
export {
  addGroup,
  assignColumn,
  COLUMN_GROUPING_KEY_PREFIX,
  createColumnGroupingStore,
  emptyGroupingView,
  layoutColumns,
  parseGroupingView,
  pruneGroupingView,
  removeGroup,
  renameColumnMember,
  renameGroup,
  serializeGroupingView,
  toggleCollapsed,
} from "./editing/index.ts";
export type {
  ColumnGroup,
  ColumnGroupingView,
  GroupedLayout,
  KeyValueStorage,
} from "./editing/index.ts";
export {
  describeNormalization,
  NORMALIZATION_NOTICE_PREF_KEY,
  readSkipNormalizationNotice,
  writeSkipNormalizationNotice,
} from "./editing/index.ts";
export {
  TS_SOURCE_MANIFEST_KEY,
  TS_SOURCE_READONLY_HINT,
  assertTsSourceWritable,
  isTsSourceProject,
  tsSourceWriteBlockers,
} from "./editing/index.ts";
/**
 * 步骤布局：列内切分为「步骤」（等待态边界）+ 列间分支边。
 * 边界判据取自引擎的等待声明表（`@lingfan-engine/core` 的 `waitingStateOfOp`），本模块不做逐 op 判定。
 */
export {
  columnSteps,
  storySteps,
  type StepEdge,
  type StepFork,
  type StepLane,
  type StepLayout,
  type StepOptions,
  type StoryStep,
} from "./layout/index.ts";

/**
 * Script 词汇层：构建期作者词汇——builder 全部产出 StoryCommand
 * 数据（与 JSON 同族）。**命名空间导出**：词汇是子语言，`script` 是它的整体入口；
 * 作者 `const { say, menu, when } = script` 解构即用。单个词函数的具名出口见文件末尾。
 */
export * as script from "./script/index.ts";

/**
 * 字符串域类型扩充点：词汇层声明的空注册表接口必须经**包根**再导出一次，
 * 生成物 `stories.gen.d.ts` 的 `declare module "@lingfan-engine/editor"` 才合得上——
 * 模块增强只认包根出口面，`export * as script` 是命名空间、不是根出口
 * （不 re-export 时增强静默落空，注册表恒为空表、收窄失效）。
 */
export {
  type ColumnNameRegistry,
  type GuardNameRegistry,
  type InterpolationKeyRegistry,
} from "./script/index.ts";

/**
 * 词函数**具名**出口：`script` 命名空间里的词函数同时经包根再导出一次，
 * 于是 `import { say, menu } from "@lingfan-engine/editor"` 与
 * `const { say } = script` 取到同一个函数对象。
 *
 * 为什么要有这一层：编译器子语言只认具名导入与 `script` 命名空间两条路
 * （`import { say }` 的 `say` 会去 `WORD_NAMES` 里核对），但两条路里具名那条
 * 需要包根真的导出该名字——只写 `export * as script` 时，仓内靠生成物
 * 侥幸通过，**仓外消费者 tsc 报 TS2305「does not provide an export named 'say'」**。
 *
 * 只转发函数值，不转发类型：类型面由上方各域出口与词汇层注册表出口提供，
 * 此处再转发会与根出口的既有类型名重复声明。
 */
export {
  ambient,
  animate,
  animateBlock,
  arrayPop,
  arrayPush,
  assert,
  autoSave,
  background,
  bgSwitch,
  bgm,
  breakLoop,
  buttonElement,
  call,
  cell,
  character,
  cond,
  continueLoop,
  cutscene,
  define,
  defineVars,
  dialogWindow,
  dict,
  dictSet,
  drainExpressionWarnings,
  expr,
  extOp,
  forEach,
  forIn,
  func,
  guard,
  hide,
  imageElement,
  input,
  inputCandidate,
  interaction,
  jump,
  letVar,
  load,
  localVar,
  menu,
  minigame,
  navigate,
  newArray,
  notify,
  nvl,
  option,
  pause,
  pauseVideo,
  random,
  resumeVideo,
  ret,
  reward,
  save,
  saveDelete,
  say,
  sceneSetup,
  sceneType,
  se,
  seekVideo,
  set,
  setZ,
  shake,
  show,
  staticFor,
  stopAmbient,
  stopBgm,
  stopVideo,
  stopVoice,
  style,
  switchOn,
  textElement,
  textTypewriter,
  transition,
  uncharacter,
  undef,
  video,
  videoSkipable,
  voice,
  wait,
  when,
  whenChain,
  whileDo,
} from "./script/index.ts";
