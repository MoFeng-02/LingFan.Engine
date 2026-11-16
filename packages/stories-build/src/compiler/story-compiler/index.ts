/**
 * story-compiler 族出口：图谱、装配、翻译三个部分的对外面。
 *
 * 轴 = 编译流水线三段——先建图（`graph.ts`）、再装配（`assemble.ts`）、表达式与语句翻译（`translate.ts`）。
 */
export type {
  Binding,
  ColumnKind,
  CompileDiag,
  ConstValue,
  Graph,
  ModuleRecord,
  SceneRegistryEntry,
  StoryConfig,
  UiRegistryEntry,
} from "./graph.ts";
export {
  buildGraph,
  collectLabelRefs,
  DiagBag,
  foldConst,
  resolveStart,
  SCENE_REGISTER_BASENAME,
  toPosix,
} from "./graph.ts";
export type { CompiledStory } from "./assemble.ts";
export {
  compileLabelColumns,
  compileStoryFile,
  createAssembleSession,
} from "./assemble.ts";
export type {
  FuncRegistry,
  Scope,
  ScopeEntry,
  SharedCtx,
} from "./translate.ts";
export {
  createBodyCtx,
  createSharedCtx,
  makeFuncOp,
  translateStatements,
} from "./translate.ts";
