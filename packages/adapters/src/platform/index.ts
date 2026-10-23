/**
 * Tauri 宿主桥接域出口（模块单一公共入口）：需要调 Rust 命令或订阅宿主事件的
 * 适配器实现都从这里取契约与缺省实现，不直连 Tauri 运行时。
 *
 * 本域**不含任何 `@tauri-apps/api` 模块名**：桥由宿主组合根经 `installTauriBridge`
 * 装进来（模块名留在有该依赖、且只在壳里跑的组合根）。这样打包器既不会把
 * `@tauri-apps/api` 拉进浏览器/小程序形态的依赖图，产物里也不会残留解析不了的裸说明符。
 */
export {
  defaultInvoke,
  defaultListen,
  installTauriBridge,
  TauriBridgeError,
  type TauriBridge,
  type TauriInvoke,
  type TauriListen,
} from "./tauri-invoke";
