/**
 * Tauri 宿主桥接域出口（模块单一公共入口）：需要调 Rust 命令或订阅宿主事件的
 * 适配器实现都从这里取契约与缺省实现，不直连 Tauri 运行时；
 * 适配器包内只有本域的实现文件会装载 Tauri 运行时模块。
 */
export {
  defaultInvoke,
  defaultListen,
  type TauriInvoke,
  type TauriListen,
} from "./tauri-invoke";
