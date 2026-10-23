/**
 * 组合根策略出口（唯一出口）：`main.ts` 只从这里取——交付守卫、WS dev 通道、媒体端口装配、
 * 方向与全屏去重状态机。
 *
 * 本目录的叶子各自负责一件事，参数一律「具名 + 注入」：各选项的缺省值与组合根装配所用
 * 字面量一致，换宿主或换平台时只改接线，不必改叶子。装配顺序仍归组合根（`main.ts`）。
 */

/** 交付守卫：形态判定与无壳时的可见拒绝 */
export { detectTauriWindow, renderBrowserBlocked } from "./browser-gate";
/** 浏览器形态闸门：构建期开关与拒绝文案 */
export {
  BROWSER_GAME_FLAG,
  browserBlockedMessage,
  browserPlayAllowed,
  type BrowserPlayEnv,
} from "./browserGuard";
/** 接宿主通道：WS dev 桥（读工程/存档/平台）与按需加载的 Tauri 窗口 API */
export {
  connectWsDevChannel,
  loadTauriWindow,
  WS_BRIDGE_TIMEOUT_MS,
  type WsDevChannelOptions,
  type WsDevSink,
} from "./native-bridge";
/** 真壳形态的宿主桥装载：Tauri 运行时的模块名只允许出现在这一层 */
export { loadTauriBridge } from "./tauri-bridge";
/** 平台形态策略：媒体源物化阈值与两个媒体端口工厂 */
export {
  createMediaPortFactories,
  MEDIA_BLOB_SOURCE_MAX_BYTES,
  type MediaPortFactories,
  type MediaPortFactoriesOptions,
} from "./platform-policy";
/** 方向与全屏：偏好变化 → 平台调用的去重状态机（状态在各自闭包内） */
export {
  createFullscreenPolicy,
  createOrientationPolicy,
  type FullscreenPolicy,
  type FullscreenPolicyOptions,
  type OrientationPolicyOptions,
} from "./orientation";
