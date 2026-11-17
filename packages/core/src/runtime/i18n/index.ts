/**
 * 文本国际化子层出口：覆盖层合并、查表翻译、展示值派生与翻译源捕获。
 *
 * 执行器与运行层内部模块从这里取国际化成员；子层各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。源结构与派生助手是引擎内部成员，不经包根出口。
 */
export { mergeOverlayFiles, planOverlayMerge } from "./overlay.ts";
export { translate, translateElements } from "./translate.ts";
export {
  I18N_DERIVED_KEYS,
  clearSuspected,
  deriveCheckpointValue,
  deriveValue,
  emitDerivedSurfaces,
  markLegacySurfaces,
  resetSuspected,
} from "./derive.ts";
export {
  asSources,
  captureSource,
  readSources,
  recordInterpolation,
  reinterpolate,
  updateSources,
  writeSources,
  type I18nSources,
  type I18nTextSource,
  type RecordedInterpolation,
} from "./sources.ts";
