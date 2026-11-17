/**
 * i18n 工具链（正向「从故事生成 i18n」）：翻译面单一事实源（surfaces）+
 * 原文键抽取 + 宿主键归属映射 + 统一落位 + overlay 骨架生成 +
 * 缺译/多译对账与三类诊断。
 * 全部纯函数：落盘 / CLI / UI 归调用方；与诊断 originals 消费同一张面表
 * （互锁：抽取与诊断同表、骨架往返、覆盖率报告、三布局键集合一致）。
 * 宿主面 AST 扫描器在构建期专属的 ../scan/ 域（依赖 typescript，
 * 不得经本运行期出口进入包根出口可达图）；本出口不转发扫描器。
 */

export { TRANSLATE_SURFACES, valuesAtPath } from "./surfaces.ts";
export { extractStoryKeys } from "./extract.ts";
export { columnStoryKey } from "./storyKeys.ts";
export {
  HOST_OVERLAY_DIR,
  hostOverlayFile,
  MAIN_OVERLAY_FILE,
} from "./host-keys.ts";
export {
  LANG_DIR,
  mergeOverlayView,
  planOverlayPlacement,
  type MergedOverlayView,
  type OverlayPlacementGroup,
  type PlacementOptions,
} from "./plan.ts";
export {
  planOverlaySkeleton,
  type OverlaySkeletonFile,
  type SkeletonLayout,
  type SkeletonOptions,
  type SkeletonPlaceholder,
} from "./skeleton.ts";
export {
  findLayoutConflicts,
  formatI18nDiagnostics,
  formatLayoutConflicts,
  formatTranslationReport,
  formatUnmarkedTexts,
  formatUnplannedOrphans,
  layoutKeySetsConsistent,
  prunedOverlayKeys,
  reconcileTranslations,
  unplannedOrphanKeys,
  type LayoutConflict,
  type LayoutConflictSite,
  type TranslationReconcileReport,
  type UnmarkedHostText,
  type UnplannedOrphanFile,
} from "./reconcile.ts";
export {
  coverageLabelOf,
  coveragePercentOf,
  coverageWeightedPercentOf,
  coverageStateOf,
  groupKeysByStory,
  langCoverage,
  workbenchOverview,
  type CoverageState,
  type LangCoverage,
  type SkeletonLayoutChoice,
  type WorkbenchOverview,
} from "./coverage.ts";
export {
  addTranslationRow,
  isTableDirty,
  parseTranslationTable,
  removeTranslationRow,
  renameTranslationRow,
  serializeTranslationTable,
  setTranslationValue,
  type TableEdit,
  type TableParse,
  type TranslationRow,
} from "./table.ts";
