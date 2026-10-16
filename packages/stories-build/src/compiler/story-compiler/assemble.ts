/**
 * 装配族的对上游出口（本文件与 `assemble/` 目录同族，导出面与目录出口一致）。
 */
export { compileStoryFile, createAssembleSession } from "./assemble/index.ts";
export type { AssembleSession, CompiledStory } from "./assemble/index.ts";
