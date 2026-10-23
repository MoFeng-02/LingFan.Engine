/**
 * UniApp 约定入口：返回应用实例（小程序与 H5 共用同一份代码）。
 *
 * 页面装配在 `pages/index/index.vue`，宿主接线在 `mp/`——入口只负责建应用。
 */
import { createSSRApp } from "vue";
import App from "./App.vue";

export function createApp(): { app: ReturnType<typeof createSSRApp> } {
  const app = createSSRApp(App);
  return { app };
}
