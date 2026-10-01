/**
 * 预设适配器包出口：按能力域归类（save / resources / media），
 * 端口实现只从这里导出（模块单一公共入口，原子化）。
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
export {
  createBlobSource,
  type BlobSource,
  type BlobSourceOptions,
} from "./media/blobSource";
export {
  createStaticResourcePort,
  createTauriEncryptedResourcePort,
} from "./resources";
// 加密工程形态识别（唯一判定点）：无壳形态剥不开 ⇒ 前置显式拒绝 + 可操作文案
export {
  detectEncryptedProject,
  encryptedProjectMessage,
  type EncryptedProjectFinding,
} from "./resources";
// 编辑器工程模型：目录取径（FSA 句柄 / 目录 input 快照）供给工程与资源
export {
  createFileListFileSource,
  createHandleFileSource,
  createHandleProjectWriter,
  createLastProjectStore,
  createSourceProjectFilesPort,
  createSourceResourcePort,
  ensureReadAccess,
  loadDiagnosticSupply,
  locateResourceRootFromPaths,
  pickProjectDirectory,
  supportsDirectoryPicker,
  type BlobUrlOptions,
  type DiagnosticSupply,
  type LastProjectHandleStore,
  type ProjectFileSource,
} from "./resources";
export {
  createFetchProjectFilesPort,
  loadProject,
  loadProjectFromFetch,
  createTauriProjectWriter,
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
  createBrowserFullscreenApplier,
  createTauriFullscreenApplier,
  type FullscreenApplier,
  type FullscreenWindowLike,
} from "./shell";
export {
  connectWsBridge,
  createWsProjectFilesPort,
  createWsSavePort,
  createWsHostPlatform,
  DEFAULT_WS_BRIDGE_URL,
  type WsBridge,
  type WsSocketLike,
  type ConnectWsBridgeOptions,
} from "./dev";
export {
  createHostPort,
  readTauriPlatform,
  type HostPortOptions,
} from "./host";
