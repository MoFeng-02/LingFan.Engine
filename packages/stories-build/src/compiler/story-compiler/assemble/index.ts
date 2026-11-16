/**
 * 装配族出口：装配会话与整篇编译的入口。
 *
 * 轴 = 装配会话三件——形状（`types.ts`）、会话入口（`session.ts`）、函数编译细节（`functions.ts`）；
 * 闭包展开（`closure.ts`）与按需产列（`labels.ts`）是会话内的两段流程。
 * 函数编译细节属族内实现，不进出口。
 */
export { compileStoryFile, createAssembleSession } from "./session.ts";
export { compileLabelColumns } from "./labels.ts";
export type { AssembleSession, CompiledStory } from "./session.ts";
