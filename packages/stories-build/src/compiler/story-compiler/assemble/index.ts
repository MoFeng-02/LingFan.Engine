/**
 * 装配族出口：装配会话与整篇编译的入口。
 *
 * 轴 = 装配会话三件——形状（`types.ts`）、会话入口（`session.ts`）、函数编译细节（`functions.ts`）。
 * 函数编译细节属族内实现，不进出口。
 */
export { compileStoryFile, createAssembleSession } from "./session.ts";
export type { AssembleSession, CompiledStory } from "./session.ts";
