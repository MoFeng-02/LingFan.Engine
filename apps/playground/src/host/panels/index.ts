/** 面板层出口（唯一出口）：接线（装配）与视图（面板视图模型）分列两个子目录。 */
export type { AppHistory, AppHistoryOptions } from "./wiring/index.ts";
export { createAppHistory } from "./wiring/index.ts";
export type { AppPrefs, AppPrefsOptions } from "./wiring/index.ts";
export { createAppPrefs } from "./wiring/index.ts";
export type { AppSlots, AppSlotsOptions } from "./wiring/index.ts";
export { createAppSlots } from "./wiring/index.ts";
export type { KeybindingPanel, KeybindingPanelOptions } from "./views/index.ts";
export { createKeybindingPanel } from "./views/index.ts";
export { PREF_CHANNELS } from "./views/index.ts";
export type {
  PreferencesPanel,
  PreferencesPanelOptions,
} from "./views/index.ts";
export { createPreferencesPanel } from "./views/index.ts";
