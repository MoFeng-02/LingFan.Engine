/**
 * 宿主编排层出口（唯一出口）：平台无关的宿主装配逻辑收在一处。
 *
 * 四个域各管一段：cell 是跨层传值的最小接口；notices 是提示条编排；events 是
 * 叙事事件落点；panel 是面板数据整形；state 是引擎状态键 → 视图状态的投影。
 * 平台宿主（浏览器/Tauri/小程序）从这里取编排逻辑，各自提供状态单元与渲染层。
 */

/** 响应式最小接口：`Cell`/`ReadonlyCell` */
export type { Cell, ReadonlyCell } from "./cell";
/** 提示条编排 */
export {
  createNotices,
  type Notice,
  type NoticeOptions,
  type NoticeTexts,
  type Notices,
} from "./notices";
/** 叙事事件落点 */
export {
  createNarrativeEvents,
  type NarrativeEventOptions,
  type NarrativeEvents,
} from "./events";
/** 面板数据：历史聚合与槽位视图 */
export {
  buildHistoryBlocks,
  canChooseSlot,
  defaultSlotLabel,
  filterHistoryEntries,
  loadSlotViews,
  parseSlotMeta,
  type HistoryBlock,
  type HistoryEntry,
  type SlotPanelMode,
  type SlotPanelOptions,
  type SlotView,
} from "./panel";
/** 叙事视图状态投影 */
export {
  createNarrativeState,
  type MenuOption,
  type NarrativeState,
  type NarrativeStateOptions,
  type StateCells,
} from "./state";
