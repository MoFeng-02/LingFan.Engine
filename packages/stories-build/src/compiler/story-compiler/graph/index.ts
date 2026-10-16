/**
 * 图谱族出口：读源（`scan/`）与建图（`core.ts` / `build.ts` / `fold.ts` / `state-root.ts`）两段。
 *
 * 轴 = 编译流水线的第一段——先由 `scan/` 把模块读成记录，再由 `build.ts` 连成图，
 * `fold.ts` 求常值、`state-root.ts` 定状态根；`core.ts` 只放共享形状与诊断袋。
 */
export type {
  Binding,
  CompileDiag,
  ConstValue,
  Graph,
  ModuleRecord,
  StoryConfig,
} from "./core.ts";
export { DiagBag, toPosix } from "./core.ts";
export { foldConst } from "./fold.ts";
export { buildGraph, resolveStart } from "./build.ts";
