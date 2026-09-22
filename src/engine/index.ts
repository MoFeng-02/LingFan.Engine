/** 引擎公共契约出口：UI/适配器只允许从这里 import（模块单一公共入口，宪法 §3）。 */
export * from "./contracts";
export { StoryEngine } from "./engine";
export {
  baseName,
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./format";
export { assembleProject, ProjectAssemblyError } from "./project";
export { generateText, parseTextStory, TextFormatError } from "./text";
