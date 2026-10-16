/**
 * 装配面：中央舞台 / 左栏 / 右栏。
 *
 * 三者由组合根 `App.vue` 挂载，各自把工作视图与面板拼成一块可拖拽的栏；
 * 它们之间不互相 import —— 装配关系只经本出口暴露给组合根，
 * 栏内用到的视图走各自目录的出口（`../stage`、`../panels`、`../shell`）。
 */
export { default as CenterStage } from "./CenterStage.vue";
export type { CenterView } from "./CenterStage.vue";
export { default as RightPane } from "./RightPane.vue";
export type { RightTab } from "./RightPane.vue";
export { default as SidebarPane } from "./SidebarPane.vue";
