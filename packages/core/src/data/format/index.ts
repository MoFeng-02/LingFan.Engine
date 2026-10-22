/**
 * 故事 JSON 校验子域的唯一出口（对外仍是 5 个名字）。
 * 入口在 entry.ts，命令校验按 op 族分在 validate/，列形状在 column.ts。
 */
export { StoryFormatError } from "./error.ts";
export { baseName } from "./naming.ts";
export { isSingleColumnFile } from "./column.ts";
export { parseStory, parseStoryFile } from "./entry.ts";
