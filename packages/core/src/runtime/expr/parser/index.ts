/**
 * expr 解析器族出口：外部只从这里取解析器。
 *
 * 引 import 时写全 `./parser/index.ts`——同目录若同时存在 `parser.ts`，无扩展名会优先解析到文件
 * （族目录内一律显式写 index）。
 */
export { Parser } from "./parse.ts";
