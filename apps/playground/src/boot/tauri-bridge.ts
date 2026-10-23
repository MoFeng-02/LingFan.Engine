/**
 * 真壳形态的宿主桥装载：把 `@tauri-apps/api` 的 `invoke` / `listen` 装进适配器包。
 *
 * 为什么模块名必须留在这一层：适配器包是给外部工程消费的源码包，写死 Tauri 模块名会让
 * 浏览器与小程序形态在构建期就解析失败；写成变量说明符又会在产物里残留裸模块名，
 * WebView 执行时抛 `TypeError: Module name ... does not resolve to a valid URL`。
 * 组合根有该依赖、且只在真壳里跑到这里，是唯一能安全写模块名的位置。
 *
 * 静态说明符（不带 `@vite-ignore`）是刻意的：打包器据此把这两个模块打进产物，
 * 运行期不再需要解析裸模块名。
 */
import { installTauriBridge, type TauriBridge } from "@lingfan-engine/adapters";

/**
 * 装载并装配宿主桥。**必须在创建任何原生端口之前调用**——各原生端口工厂缺省用
 * `defaultInvoke`，桥没装就是 fail-closed 的类型化错误。
 *
 * 只由真壳形态（`useNative`）调用；浏览器形态走 WS dev 通道，不触碰 Tauri 运行时。
 */
export async function loadTauriBridge(): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  const bridge: TauriBridge = { invoke, listen };
  installTauriBridge(bridge);
}
