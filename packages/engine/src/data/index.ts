/** 数据层域出口：文件形态解析（JSON v1 / .story 混存）+ 工程组装 + 文本投影（双向）。 */
export {
  baseName,
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./format/index.ts";
export {
  assembleProject,
  conflictMessage,
  detectWriteConflicts,
  detectWriteNormalization,
  ProjectAssemblyError,
  diffProjectFiles,
  isSafeFileNameSegment,
  MANIFEST_FILE,
  ProjectSerializationError,
  serializeColumnDocument,
  serializeProject,
  STORIES_DIR,
  synthesizeDegradedManifest,
  type FileStamp,
  type ProjectFileDiff,
  type SerializedProject,
  type WriteNormalizationFinding,
} from "./project/index.ts";
export {
  findElements,
  loadElements,
  removeElements,
  validateElement,
  validateElementNode,
} from "./element.ts";
export {
  drainTextProjectionWarnings,
  generateText,
  parseTextStory,
  projectText,
  TextFormatError,
  type TextProjection,
} from "./text/index.ts";
