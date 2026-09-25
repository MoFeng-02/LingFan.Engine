/**
 * 预设适配器包出口：按能力域归类（save / resources / media），
 * 端口实现只从这里导出（模块单一公共入口，宪法 §3 原子化）。
 * 默认集为纯 Web/WebView 实现；原生实现（Tauri Desktop/Mobile）由组合根按构建模式装配。
 */
export { createTauriSavePort, createWebStorageSavePort } from "./save";
export {
  createWebAudioPort,
  type WebAudioPortOptions,
} from "./media/audioPort";
export {
  createWebVideoPort,
  type WebVideoPortOptions,
} from "./media/videoPort";
export { createStaticResourcePort } from "./resources";
export { createTauriEncryptedResourcePort } from "./resources";
export {
  createFetchProjectFilesPort,
  loadProject,
  loadProjectFromFetch,
  type FetchProjectFilesOptions,
} from "./resources";
export {
  createTauriProjectFilesPort,
  watchTauriProjectFiles,
  type StoryWatcher,
  type TauriInvoke,
  type TauriListen,
  type TauriProjectFiles,
} from "./resources";
export { createTauriI18nPort, type TauriOverlayFile } from "./i18n";
export {
  createTauriPreferencesPort,
  createWebStoragePreferencesPort,
} from "./preferences";
export {
  createNoopOrientationPort,
  createTauriOrientationPort,
} from "./shell";
export {
  createHostPort,
  readTauriPlatform,
  type HostPortOptions,
} from "./host";
