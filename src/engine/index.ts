/** 引擎公共契约出口：UI/适配器只允许从这里 import（模块单一公共入口，分层纪律 对应章节）。 */
export * from "./contracts";
export { StoryEngine } from "./engine";
export { parseStory, StoryFormatError } from "./format";
