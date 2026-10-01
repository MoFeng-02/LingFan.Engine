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
export {
  BUILTIN_OP_SURFACE,
  mergeOpMeta,
  mergeOpSchemas,
  mergeOpSurface,
  type OpSurface,
} from "./schema/surface";
export { validateStory } from "./schema/validation";
export { walkCommandBodies, walkStoryCommands, walkStoryElements } from "./schema/walk";

export { analyzeStory, extractExpressionRefs, indexStory } from "./diagnostics";

export {
  extractStoryKeys,
  formatTranslationReport,
  planOverlaySkeleton,
  reconcileTranslations,
  TRANSLATE_SURFACES,
  valuesAtPath,
  type OverlaySkeletonFile,
  type SkeletonLayout,
  type SkeletonOptions,
  type SkeletonPlaceholder,
  type TranslationReconcileReport,
} from "./i18n";

export {
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  nearestCommandPointer,
  removeAtPointer,
  setAtPointer,
} from "./editing/pointers";
export {
  addColumn,
  columnContainers,
  containerPointer,
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
