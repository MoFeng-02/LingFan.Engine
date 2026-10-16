/**
 * 图谱族的对上游出口（本文件与 `graph/` 目录同族，导出面与目录出口一致）。
 */
export type {
  Binding,
  CompileDiag,
  ConstValue,
  Graph,
  ModuleRecord,
  StoryConfig,
} from "./graph/index.ts";
export {
  buildGraph,
  DiagBag,
  foldConst,
  resolveStart,
  toPosix,
} from "./graph/index.ts";
