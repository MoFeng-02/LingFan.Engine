/**
 * 宿主面板域出口：偏好设置面板 + 历史面板。
 *
 * 偏好面板的扩展控件（显示/无障碍组）与行构件拆在同目录 sibling 文件
 * （preferences-display / preferences-dom），由 preferences.ts 内部组装，
 * 不对外暴露——调用方只经本出口拿两个面板的公共面。
 */
export {
  PREF_CHANNELS,
  createPreferencesPanel,
  type PreferencesPanel,
  type PreferencesPanelOptions,
  type PreferencesPanelView,
} from "./preferences";
export {
  createHistoryPanel,
  type HistoryEngine,
  type HistoryPanel,
  type HistoryPanelOptions,
  type HistoryPanelView,
} from "./history";
