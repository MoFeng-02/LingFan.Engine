/**
 * 交付守卫的宿主侧支持：判定页面跑在壳内还是外部浏览器，以及无壳时把可操作说明
 * 写进页面。
 *
 * 为什么需要：正式交付只应是 Tauri 壳（Rust 命令面 + 加密资源），浏览器形态只提供
 * 静态根（`fetch` + 明文 `Resources/**`）——两种供给面不可共存于同一个交付物。故组合根
 * 在装配端口之前先过守卫，无壳且未显式放行即拒绝启动，页面不留白屏也不静默退场。
 */
import { browserBlockedMessage } from "../browserGuard";

/**
 * 形态判定用**运行时事实**而非只看构建标记：tauri 形态的页面可能落在外部浏览器
 * （`tauri dev` 时用浏览器打开 dev 服务器），那时同样没有壳、invoke 不可用。
 */
export function detectTauriWindow(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 无壳且未放行时的可见拒绝：把可操作说明写进 `#app`，并记一条控制台诊断。
 * `#app` 缺失时只留诊断（页面已被别的东西接管，写不进去也不报错）。
 */
export function renderBrowserBlocked(): void {
  const root = document.querySelector("#app");
  const message = browserBlockedMessage();
  if (root !== null) root.textContent = message;
  console.error(`[lfen] ${message}`);
}
