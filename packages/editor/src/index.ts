/**
 * @lingfan/editor 公共出口（06 编辑器核心）：op schema 单一事实源 + 编辑期诊断 +
 * 故事树纯映射器。D1：只读写故事 JSON，不碰运行时与 Rust。
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

export { describeForm, listOps } from "./schema/forms";
export { OP_SCHEMAS, validateCommand } from "./schema/opSchemas";
export { validateStory } from "./schema/validation";
export { walkStoryCommands } from "./schema/walk";

export { analyzeStory, extractExpressionRefs, indexStory } from "./diagnostics";

export {
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
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
  updateCommandField,
} from "./editing/storyOps";
export { EditorSession } from "./editing/session";
