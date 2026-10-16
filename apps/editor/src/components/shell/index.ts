/**
 * 外壳族：不属于任何一栏的常驻件（顶栏 / 状态栏 / 分栏条 / 横幅 / 空态 / 对话框宿主）。
 *
 * 判据：它们被多个面共用（`PaneSplitter` 左右栏都要、`EmptyState` 舞台与栏内都要），
 * 或代表应用级事实（`StatusBar` 工程状态、`ProjectBanners` 保存反馈）；
 * 因此不归入 `../panes`、`../stage` 等任一栏，谁需要就经本出口取。
 */
export { default as TopToolbar } from "./TopToolbar.vue";
export { default as StatusBar } from "./StatusBar.vue";
export { default as PaneSplitter } from "./PaneSplitter.vue";
export { default as ProjectBanners } from "./ProjectBanners.vue";
export { default as EmptyState } from "./EmptyState.vue";
export { default as DialogHost } from "./DialogHost.vue";
