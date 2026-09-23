/** 08-U7 / 07 §三 资源与工程供给域出口：ResourcePort + ProjectFilesPort 的 Web/WebView 实现。 */
export { createStaticResourcePort } from "./resourcePort";
export {
  createFetchProjectFilesPort,
  loadProjectFromFetch,
  type FetchProjectFilesOptions,
} from "./projectLoader";
