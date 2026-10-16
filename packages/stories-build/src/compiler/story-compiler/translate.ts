/**
 * 翻译族的对上游出口（本文件与 `translate/` 目录同族，导出面与目录出口一致）。
 */
export type {
  FuncRegistry,
  Scope,
  ScopeEntry,
  SharedCtx,
} from "./translate/index.ts";
export {
  createBodyCtx,
  createSharedCtx,
  makeFuncOp,
  translateStatements,
} from "./translate/index.ts";
