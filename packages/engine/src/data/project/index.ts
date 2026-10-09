/**
 * 工程文件子域的唯一出口（对外仍是原有的 13 个值 + 4 个类型）。
 * 形态契约类型定义在契约层，此处按原路径转出，既有消费方无需改动即可继续取用。
 *
 * error  整次拒绝的两支错误
 * naming 清单名 / 故事目录名 / 路径序 / 文件名安全段
 * assemble 读向；serialize 写向；diff 差量；conflict 保存前检测
 */
export type {
  FileStamp,
  ProjectFileDiff,
  SerializedProject,
  WriteNormalizationFinding,
} from "../../contracts";
export { ProjectAssemblyError, ProjectSerializationError } from "./error";
export { isSafeFileNameSegment, MANIFEST_FILE, STORIES_DIR } from "./naming";
export { assembleProject, synthesizeDegradedManifest } from "./assemble";
export { serializeColumnDocument, serializeProject } from "./serialize";
export { diffProjectFiles } from "./diff";
export { conflictMessage, detectWriteConflicts, detectWriteNormalization } from "./conflict";
