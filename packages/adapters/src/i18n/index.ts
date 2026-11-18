/** I18N 供给域出口：overlay 译文的 Tauri 原生实现与 Web/HTTP 静态根供给。 */
export { createTauriI18nPort, type TauriOverlayFile } from "./tauriI18n";
export {
  createFetchI18nPort,
  createHttpI18nPort,
  type FetchI18nOptions,
  type HttpI18nOptions,
  type I18nLangEntry,
} from "./webI18n";
