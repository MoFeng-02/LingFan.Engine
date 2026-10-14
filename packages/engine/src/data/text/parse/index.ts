/** 读向解析的入口：列体收集与单行分发。 */
export { collectBody, isBlockOp, parseCommands } from "./block.ts";
export { parseSimpleStatement } from "./statement.ts";
export type { ParseState } from "./state.ts";
