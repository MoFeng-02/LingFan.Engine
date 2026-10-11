// graph.ts —— 纯转发出口（原单文件实现拆分至 graph/ 子目录，导入路径零改动）
export type {
  CompileDiag,
  ConstValue,
  Binding,
  ModuleRecord,
  StoryConfig,
  Graph,
} from "./graph/core";
export { DiagBag, toPosix } from "./graph/core";
export { foldConst } from "./graph/fold";
export { buildGraph, resolveStart } from "./graph/build";
