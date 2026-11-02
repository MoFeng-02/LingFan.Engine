/**
 * 会话装配族的出口：对局会话、挂载 UI 钩子、注入契约与五趟总装。
 *
 * 本文件只做具名转发与类型声明，不含实现。
 */

export type { AppSession, AppSessionOptions } from "./app-session.ts";
export { createAppSession } from "./app-session.ts";
export type { AppUiHooksOptions } from "./app-ui-hooks.ts";
export { attachAppUiHooks } from "./app-ui-hooks.ts";
export type { AppProps } from "./app-props.ts";
export type {
  AppEventRouter,
  AppEventRouterOptions,
  AppLifecycle,
  AppLifecycleOptions,
  AppMounts,
  AppMountsOptions,
  AppPanels,
  AppPanelsOptions,
  AppStageView,
  AppStageViewOptions,
} from "./wiring/index.ts";
export {
  createAppEventRouter,
  createAppLifecycle,
  createAppMounts,
  createAppPanels,
  createAppStageView,
} from "./wiring/index.ts";
