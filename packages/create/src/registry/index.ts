/** registry 域唯一出口：模板元数据定位 + npm 版本查询 + 引擎兼容判定。 */
export { checkEngineCompatibility, ENGINE_SCOPE } from "./compat.ts";
export {
  existsLayerDirectory,
  findConflicts,
  overlayDirOf,
  readTemplateMeta,
  resolveTemplateRoot,
  selectableLayers,
  OVERLAY_DIR,
  type LayerConflict,
  type TemplateMeta,
  type TemplateOption,
} from "./template-meta.ts";
export {
  applyResolvedVersions,
  fetchLatestVersion,
  resolveVersions,
  type ResolvedVersion,
} from "./versions.ts";
