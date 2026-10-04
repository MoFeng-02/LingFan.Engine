/**
 * 05 i18n 工具链（正向「从故事生成 i18n」）：翻译面单一事实源（surfaces）+
 * 原文键抽取 + overlay 骨架生成 + 缺译/多译对账。
 * 全部纯函数：落盘 / CLI / UI 归调用方；与诊断 originals 消费同一张面表
 * （互锁：抽取与诊断同表、骨架往返、覆盖率报告）。
 */

export { TRANSLATE_SURFACES, valuesAtPath } from "./surfaces";
export { extractStoryKeys } from "./extract";
export {
  planOverlaySkeleton,
  type OverlaySkeletonFile,
  type SkeletonLayout,
  type SkeletonOptions,
  type SkeletonPlaceholder,
} from "./skeleton";
export {
  formatTranslationReport,
  reconcileTranslations,
  type TranslationReconcileReport,
} from "./reconcile";
export {
  coverageLabelOf,
  coveragePercentOf,
  coverageStateOf,
  groupKeysByStory,
  langCoverage,
  workbenchOverview,
  type CoverageState,
  type LangCoverage,
  type SkeletonLayoutChoice,
  type WorkbenchOverview,
} from "./coverage";
