/**
 * 包唯一公共入口。
 *
 * 只做转发：库里没有「怎么问」与「怎么打印」的实现，那些属于 CLI；
 * 这里暴露的是「给定参数就能算出产物」的那一层，供测试与将来的图形化前端复用。
 */
export {
  collectDependencyNames,
  DEFAULT_SOURCES,
  generateProject,
  layerBases,
  SKELETON_DIR,
  isTextPath,
  PLACEHOLDERS,
  replaceInFile,
  replacePlaceholders,
} from "./generate/index.ts";
export type { GenerateOptions, GenerateResult } from "./generate/index.ts";
export {
  deepMerge,
  listFiles,
  mergeLayers,
  readLayer,
  PATCH_SUFFIX,
} from "./overlay/index.ts";
export type { MergedLayer, PendingFile } from "./overlay/index.ts";
export {
  applyResolvedVersions,
  fetchLatestVersion,
  overlayDirOf,
  readTemplateMeta,
  resolveTemplateRoot,
  resolveVersions,
  OVERLAY_DIR,
} from "./registry/index.ts";
export type {
  ResolvedVersion,
  TemplateMeta,
  TemplateOption,
} from "./registry/index.ts";
export {
  caretRange,
  isValidProjectName,
  suggestProjectName,
} from "./shared/index.ts";
export { defaultCreateTexts } from "./shared/index.ts";
export type { CreateTexts } from "./shared/index.ts";
