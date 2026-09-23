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
export {
  createFetchProjectFilesPort,
  loadProjectFromFetch,
  type FetchProjectFilesOptions,
} from "./resources";
