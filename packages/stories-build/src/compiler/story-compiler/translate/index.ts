/**
 * 翻译族出口：TS 源到引擎命令的翻译。
 *
 * 轴 = 三段——表达式与赋值（`expr/`）、语句与控制流（`stmt/`）、共享上下文与词表
 * （`shared.ts`），外加一处字体引用检查（`font-check.ts`）。
 */
export type { FuncRegistry, Scope, ScopeEntry, SharedCtx } from "./shared.ts";
export { createBodyCtx, createSharedCtx, makeFuncOp } from "./shared.ts";
export { checkFontReferences } from "./font-check.ts";
export { translateStatements } from "./stmt/index.ts";
