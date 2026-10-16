/**
 * story-compiler 族出口：图谱、装配、翻译三个部分的对外面。
 *
 * 轴 = 编译流水线三段——先建图（`graph.ts`）、再装配（`assemble.ts`）、表达式与语句翻译（`translate.ts`）。
 */
export type {
  Binding,
  CompileDiag,
  ConstValue,
  Graph,
  ModuleRecord,
  StoryConfig,
} from "./graph.ts";
export {
  buildGraph,
  DiagBag,
  foldConst,
  resolveStart,
  toPosix,
} from "./graph.ts";
export type { CompiledStory } from "./assemble.ts";
export { compileStoryFile, createAssembleSession } from "./assemble.ts";
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
