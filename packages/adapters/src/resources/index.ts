/**
 * 资源与工程供给域出口：ResourcePort + ProjectFilesPort 的
 * Web/WebView、Tauri 与**目录取径**（编辑器：FSA 句柄 / 目录 input 快照）实现。
 */
export { createStaticResourcePort, normalizeResourceId } from "./resourcePort";
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
} from "./directorySource";
export {
  createFetchProjectFilesPort,
  loadProject,
  loadProjectFromFetch,
  type FetchProjectFilesOptions,
} from "./projectLoader";
export {
  createTauriProjectWriter,
  type TauriProjectWriterOptions,
} from "./projectWriterTauri";
export {
  createTauriProjectFilesPort,
  watchTauriProjectFiles,
  type StoryWatcher,
  type TauriInvoke,
  type TauriListen,
  type TauriProjectFiles,
} from "./projectFilesTauri";
export { createTauriEncryptedResourcePort } from "./resourceCrypto";
