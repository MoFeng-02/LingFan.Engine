/** 01 数据层域出口：文件形态解析（JSON v1 / .story 混存）+ 工程组装 + 07 文本投影（双向）。 */
export {
  baseName,
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./format";
export { assembleProject, ProjectAssemblyError } from "./project";
export {
  generateText,
  parseTextStory,
  projectText,
  TextFormatError,
  type TextProjection,
} from "./text";
