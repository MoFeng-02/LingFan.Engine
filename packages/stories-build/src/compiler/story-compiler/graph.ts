/**
 * 图谱族的对上游出口（本文件与 `graph/` 目录同族，导出面与目录出口一致）。
 */
export type {
  Binding,
  ColumnKind,
  CompileDiag,
  ComponentRecord,
  ComponentRegistryEntry,
  ConstValue,
  Graph,
  JsonObject,
  JsonValue,
  LabelRef,
  ModuleRecord,
  SceneRecord,
  SceneRegistryEntry,
  StoryConfig,
  UiRecord,
  UiRegistryEntry,
} from "./graph/index.ts";
export {
  buildGraph,
  COLUMN_BODY_DECL,
  COLUMN_BODY_PROPS_DECL,
  COLUMN_KIND_DECL,
  collectLabelRefs,
  DiagBag,
  foldConst,
  resolveStart,
  SCENE_DIR_NAME,
  SCENE_REGISTER_BASENAME,
  toPosix,
  UI_DIR_NAME,
  UI_REGISTER_BASENAME,
} from "./graph/index.ts";
