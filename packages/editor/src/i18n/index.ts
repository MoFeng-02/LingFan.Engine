/**
 * 05 i18n 工具链（正向「从故事生成 i18n」）：翻译面单一事实源（surfaces）+
 * 原文键抽取（T05-01）+ overlay 骨架生成（T05-02）+ 缺译/多译对账（T05-03）。
 * 全部纯函数：落盘 / CLI / UI 归调用方；与诊断 originals 消费同一张面表
 * （锚点: i18n-key-extract-parity / i18n-skeleton-roundtrip / i18n-coverage-report）。
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
