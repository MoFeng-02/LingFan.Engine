/**
 * 面板数据域：历史与槽位面板的数据整形与装配。
 *
 * 面板本身（DOM/组件）属于各平台宿主；这里只做「引擎数据 → 可直接渲染的视图」，
 * 让每个宿主的模板保持零逻辑。
 */

export * from "./history.ts";
export * from "./slotTexts.ts";
export * from "./slots.ts";
