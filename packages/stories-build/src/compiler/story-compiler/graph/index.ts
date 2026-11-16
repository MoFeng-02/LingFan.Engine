/**
 * 图谱族出口：读源（`scan/`）与建图（`core.ts` / `build.ts` / `fold.ts` / `state-root.ts`）两段。
 *
 * 轴 = 编译流水线的第一段——先由 `scan/` 把模块读成记录，再由 `build.ts` 连成图，
 * `fold.ts` 求常值、`state-root.ts` 定状态根；`core.ts` 只放共享形状与诊断袋。
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
  ModuleRecord,
  SceneRecord,
  SceneRegistryEntry,
  StoryConfig,
  UiRecord,
  UiRegistryEntry,
} from "./core.ts";
export {
  COLUMN_BODY_DECL,
  COLUMN_BODY_PROPS_DECL,
  COLUMN_FONT_DECL,
  COLUMN_KIND_DECL,
  COLUMN_TYPE_DECL,
  DiagBag,
  SCENE_DIR_NAME,
  SCENE_REGISTER_BASENAME,
  toPosix,
  UI_DIR_NAME,
  UI_EXTENSIONS,
  UI_REGISTER_BASENAME,
  uiExtensionOf,
} from "./core.ts";
export { foldConst } from "./fold.ts";
export { buildGraph, resolveStart } from "./build.ts";
export { collectLabelRefs } from "./label-refs.ts";
export type { LabelRef } from "./label-refs.ts";
export { createUiChannel } from "./scan/ui-specifier.ts";
export type { UiChannel, UiOutcome } from "./scan/ui-specifier.ts";
export { createSceneChannel } from "./scan/scene-specifier.ts";
export type { SceneChannel, SceneOutcome } from "./scan/scene-specifier.ts";
export { createComponentChannel } from "./scan/component-specifier.ts";
export type {
  ComponentChannel,
  ComponentOutcome,
} from "./scan/component-specifier.ts";
