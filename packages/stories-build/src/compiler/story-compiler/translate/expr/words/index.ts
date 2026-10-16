/**
 * 词命令族出口：命令发射总入口、词表调用（含字体检查单点）与函数 callee 解析。
 *
 * `emitCommand` 是族内递归入口，经 `WordDispatch` 注入给 `arg.ts` /
 * `static-for.ts`（见 `dispatch.ts`）；族外只需这四个名字。
 */
export { callWord, emitCallCommand, resolveFunctionCallee } from "./call.ts";
export { emitCommand } from "./command.ts";
