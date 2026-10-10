/**
 * 舞台面板出口：舞台的模板与样式按面板各成文件，这里只做转发。
 *
 * 组合根（`App.vue`）从这一处取全部面板；每个面板自带承载其标记的样式。
 */
export { default as DemoHost } from "./DemoHost.vue";
export { default as DialoguePanel } from "./DialoguePanel.vue";
export { default as SettingsPanels } from "./SettingsPanels.vue";
export { default as ToolbarPanel } from "./ToolbarPanel.vue";
