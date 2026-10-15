// assemble.ts —— 纯转发出口（原单文件实现拆分至 assemble/ 子目录，导入路径零改动）
export type { AssembleSession, CompiledStory } from "./assemble/session.ts";
export { createAssembleSession, compileStoryFile } from "./assemble/session.ts";
