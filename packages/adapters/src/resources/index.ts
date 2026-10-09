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
} from "./directory-source";
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
  type TauriProjectFiles,
} from "./projectFilesTauri";
// Tauri 桥接契约由平台域统一定义，此处转发以保持资源域出口的类型面不变
export type { TauriInvoke, TauriListen } from "../platform";
export { createTauriEncryptedResourcePort } from "./resourceCrypto";
/**
 * 加密工程形态识别（唯一判定点）：浏览器形态前置拒绝 + 可操作文案；
 * 编辑器桌面壳落地后，同一判定点改走宿主解密供给（规则不重写）。
 */
export {
  detectEncryptedProject,
  encryptedProjectMessage,
  type EncryptedProjectFinding,
} from "./encryptedProject";
