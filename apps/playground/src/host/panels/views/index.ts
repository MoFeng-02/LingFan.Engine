/** 面板视图叶子件：键位与偏好两个面板的视图模型，外加存档名的取用规则。 */
export type {
  KeybindingPanel,
  KeybindingPanelOptions,
} from "./keybinding-panel.ts";
export { createKeybindingPanel } from "./keybinding-panel.ts";
export { PREF_CHANNELS } from "./preferences-panel.ts";
export type {
  PreferencesPanel,
  PreferencesPanelOptions,
} from "./preferences-panel.ts";
export { createPreferencesPanel } from "./preferences-panel.ts";
export { autoSaveTitle, resolveSaveTitle } from "./save-title.ts";
