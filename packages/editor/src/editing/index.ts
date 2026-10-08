/**
 * 编辑域出口：JSON Pointer 读取与不可变树编辑、列/命令的结构化改写、
 * 编辑器会话状态、分支连线规划、列分组视图偏好与存档前规范化提示。
 * 全部为纯映射器，只读写故事 JSON。
 */
export {
  emptyGroupingView,
  parseGroupingView,
  serializeGroupingView,
  pruneGroupingView,
  layoutColumns,
  addGroup,
  renameGroup,
  removeGroup,
  assignColumn,
  renameColumnMember,
  toggleCollapsed,
  COLUMN_GROUPING_KEY_PREFIX,
  createColumnGroupingStore,
  type ColumnGroup,
  type ColumnGroupingView,
  type GroupedLayout,
  type KeyValueStorage,
} from "./columnGrouping";
export {
  isBranchTarget,
  planBranchInsertion,
  branchPointerToCommand,
  type BranchPlan,
  type BranchColumnLike,
} from "./graphConnect";
export {
  buildPointer,
  parsePointer,
  getAtPointer,
  setAtPointer,
  removeAtPointer,
  insertAtPointer,
  moveAtPointer,
  nearestCommandPointer,
  describeSelection,
  type SelectionKind,
  type SelectionNodeKind,
  type SelectionDescription,
} from "./pointers";
export {
  NORMALIZATION_NOTICE_PREF_KEY,
  readSkipNormalizationNotice,
  writeSkipNormalizationNotice,
  describeNormalization,
} from "./saveNormalization";
export { EditorSession } from "./session";
export {
  columnContainers,
  containerPointer,
  suggestColumnId,
  addColumn,
  removeColumn,
  firstColumnIdOfSourcePath,
  renameColumn,
  insertCommand,
  removeCommand,
  updateCommandField,
  moveCommand,
} from "./storyOps";
