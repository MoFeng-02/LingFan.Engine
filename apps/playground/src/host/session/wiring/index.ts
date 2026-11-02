/**
 * 会话装配族的出口：舞台视图、面板投影、挂载接管、事件分流与生命周期五趟总装。
 *
 * 本文件只做具名转发，不含实现——总装函数体住在同级各叶子文件里，装配层（`App.vue`）
 * 经 `host/` 的出口取用。
 */

export type { AppStageView, AppStageViewOptions } from "./app-stage-view";
export { createAppStageView } from "./app-stage-view";
export type { AppPanels, AppPanelsOptions } from "./app-panels";
export { createAppPanels } from "./app-panels";
export type { AppMounts, AppMountsOptions } from "./app-mounts";
export { createAppMounts } from "./app-mounts";
export type { AppEventRouter, AppEventRouterOptions } from "./app-event-router";
export { createAppEventRouter } from "./app-event-router";
export type { AppLifecycle, AppLifecycleOptions } from "./app-lifecycle";
export { createAppLifecycle } from "./app-lifecycle";
