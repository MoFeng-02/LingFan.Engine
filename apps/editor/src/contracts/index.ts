/**
 * 契约层：编辑器内跨层共享的类型、常量与注入键。
 *
 * 为什么单独成层：各层都要用到同一批类型与注入键，若把它们散在实现文件里，
 * 就会出现同一份声明被复制多份、彼此慢慢走样。这里只放**声明**，不放实现——
 * 各层依赖它，它不依赖任何层，也不引用平台适配器包，
 * 这样视图组件取契约时不会顺带把平台实现拖进浏览器产物。
 */
export { type EditorApiPort } from "./editor";
export {
  COLUMN_GROUPING_API_KEY,
  COLUMN_PATHS_KEY,
  EDITOR_API_KEY,
  SELECTED_POINTER_KEY,
  type ColumnGroupingApi,
} from "./injection-keys";
export {
  type HostCapabilities,
  type PackRequest,
  type PackResult,
  type WatchStatus,
} from "./host";
