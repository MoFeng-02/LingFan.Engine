/**
 * 宿主编排层出口（唯一出口）：平台无关的宿主装配逻辑收在一处。
 *
 * 各域各管一段：cell 是跨层传值的最小接口；notices 是提示条编排；events 是
 * 叙事事件落点；panel 是面板数据整形；state 是引擎状态键 → 视图状态的投影；
 * frame 是宿主帧循环装配；stage 是舞台适配计算（视口 → 缩放与偏移）。平台宿主
 * （浏览器/Tauri/小程序）从这里取编排逻辑，各自提供状态单元、帧源、视口尺寸与渲染层。
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
  withSlotLabels,
  type HistoryBlock,
  type HistoryEntry,
  type SlotPanelMode,
  type SlotPanelOptions,
  type SlotView,
} from "./panel";
/** 叙事视图状态投影 */
export {
  createNarrativeState,
  type MenuChoice,
  type NarrativeState,
  type NarrativeStateOptions,
  type StateCells,
} from "./state";
/** 宿主帧循环：帧源由宿主注入，覆盖层与各宿主共用一份实现 */
export { startHostFrameLoop, type HostFrameLoopOptions } from "./frame";
/** 舞台适配：设计基准 + 策略 → 缩放与偏移，视口尺寸由宿主读 */
export {
  computeStageLayout,
  DEFAULT_STAGE_FIT,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  resolveStagePreset,
  stageTransform,
  STAGE_BASELINES,
  STAGE_PRESETS,
  type StageAlign,
  type StageBaseline,
  type StageConfig,
  type StageFit,
  type StageLayout,
  type StagePreset,
  type StageScalePolicy,
  type StageViewport,
} from "./stage";
