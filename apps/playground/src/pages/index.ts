/**
 * 普通页面出口（唯一出口）：进游戏之前的界面与对局中的暂停菜单。
 *
 * 这些页面属宿主应用层，与引擎无关——它们不是 `src/ui/` 下的挂载 UI，
 * 不参与 `scanUiRegistry` 的扫描，也不进 `uis` 表。
 */
export { default as PausePage } from "./pause/pause.vue";
export { default as StartPage } from "./start/start.vue";
