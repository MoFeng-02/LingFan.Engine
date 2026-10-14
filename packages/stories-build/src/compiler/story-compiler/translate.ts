// translate.ts —— 纯转发出口（原单文件实现拆分至 translate/ 子目录，导入路径零改动）
export type {
  ScopeEntry,
  Scope,
  FuncRegistry,
  SharedCtx,
} from "./translate/shared.ts";
export { createBodyCtx, makeFuncOp, createSharedCtx } from "./translate/shared.ts";
export { translateStatements } from "./translate/statements.ts";
