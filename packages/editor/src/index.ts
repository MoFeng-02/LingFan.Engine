/**
 * @lingfan/editor 公共出口：op schema 单一事实源 + 编辑期诊断 +
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
} from "./contracts";
export { escapePointerToken, joinPointer } from "./contracts";

export {
  coerceFieldValue,
  describeForm,
  describeNodeLabel,
  listOps,
} from "./schema/forms";
export {
  describeElement,
  elementLabel,
  listElementTypes,
  specificAttrsOf,
  UNIMPLEMENTED_ELEMENT_ATTRS,
  type ElementFormDescriptor,
} from "./schema/elementForms";
export {
  ELEMENT_TYPE_GROUPS,
  listOpGroups,
  OP_GROUP_LABELS,
  OP_GROUP_ORDER,
  type ElementTypeGroup,
  type OpGroupEntries,
} from "./schema/elementPalette";
export { draggedPosition, parseNumericPosition } from "./element/drag";
export {
  createElementDraft,
  planElementDrop,
  type DropContainerHit,
  type ElementDropPlan,
} from "./element/dragCreate";
export { OP_SCHEMAS, validateCommand } from "./schema/opSchemas";
/**
 * 内建 op 判别联合（op 决定字段）+ 单 op 命令类型 + 标量值口径——
 * 全部派生自 op schema 单一事实源；词汇层 builder 返回与裸写命令注解共用。
 */
export type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
  ScriptValue,
} from "./schema/opSchemas";
/** 词汇层构建期轻类型校验警告（expr/cond 组装时按引擎类型规则产出；drain 取走） */
export type { ExpressionWarning } from "./script/expr";
export {
  BUILTIN_OP_SURFACE,
  mergeOpMeta,
  mergeOpSchemas,
  mergeOpSurface,
  type OpSurface,
} from "./schema/surface";
export { validateStory } from "./schema/validation";
export {
  walkCommandBodies,
  walkStoryCommands,
  walkStoryElements,
} from "./schema/walk";

export { analyzeStory, extractExpressionRefs, indexStory } from "./diagnostics";
export {
  diagnosticCodeLabel,
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  summarizeDiagnostics,
  type DiagnosticGroup,
  type DiagnosticSummary,
  type SeverityFilter,
} from "./diagnostics/grouping";
export {
  diagnosticBrief,
  splitDiagnosticMessage,
  type DiagnosticMessageParts,
} from "./diagnostics/message";
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
} from "./chapters";

export {
  addTranslationRow,
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
} from "./i18n";

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
} from "./editing/pointers";
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
} from "./editing/storyOps";
export { EditorSession } from "./editing/session";
export {
  branchPointerToCommand,
  isBranchTarget,
  planBranchInsertion,
  type BranchColumnLike,
  type BranchPlan,
} from "./editing/graphConnect";
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
} from "./editing/columnGrouping";
export type {
  ColumnGroup,
  ColumnGroupingView,
  GroupedLayout,
  KeyValueStorage,
} from "./editing/columnGrouping";
export {
  describeNormalization,
  NORMALIZATION_NOTICE_PREF_KEY,
  readSkipNormalizationNotice,
  writeSkipNormalizationNotice,
} from "./editing/saveNormalization";
/**
 * 步骤布局：列内切分为「步骤」（等待态边界）+ 列间分支边。
 * 边界判据取自引擎的等待声明表（`@lingfan/engine` 的 `waitingStateOfOp`），本模块不做逐 op 判定。
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
} from "./layout/steps";

/**
 * Script 词汇层（设计稿 2026-10-06）：构建期作者词汇——builder 全部产出 StoryCommand
 * 数据（与 JSON 同族）。**命名空间导出**：词汇是子语言，`script` 隔离避免常用词
 * （set/define/say）与既有出口冲突；作者 `const { say, menu, when } = script` 解构即用。
 */
export * as script from "./script";
