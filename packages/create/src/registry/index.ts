/** registry 域唯一出口：模板元数据定位 + npm 版本查询。 */
export {
  overlayDirOf,
  readTemplateMeta,
  resolveTemplateRoot,
  OVERLAY_DIR,
  type TemplateMeta,
  type TemplateOption,
} from "./template-meta.ts";
export {
  applyResolvedVersions,
  fetchLatestVersion,
  resolveVersions,
  type ResolvedVersion,
} from "./versions.ts";
