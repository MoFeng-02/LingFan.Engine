/**
 * 浏览器参考宿主的宿主层出口（唯一出口）：把叙事视图、事件落点、帧驱动、元素层、
 * 层 z、面板装配与演示工厂收在一处，`App.vue` 只从这里取。
 *
 * 本目录的叶子各自负责一件事，彼此不互相依赖组合根：需要引擎、端口或 DOM 句柄的地方
 * 一律以具名注入（函数或接口）取得，于是每个叶子都能单独读、单独测，换宿主时只需换接线。
 * 组合根本身（`main.ts`）不属于这里——那是装配顺序的归属地。
 */

/** 中止句柄收窄：契约层只用语言核心类型，宿主侧要的是 `AbortSignal` */
export { abortSignalOf } from "./abort-signal";
/** —— 宿主装配层：App.vue 组合根把下列装配接到一起（视图/媒体/面板各一域）—— */
/** 叙事视图状态与层 z：状态投影、z 镜像与打字机共享句柄 */
export {
  createAppNarrative,
  type AppNarrative,
  type AppNarrativeOptions,
  type TypewriterHandle,
} from "./app-narrative";
/** 语言选择：可用语言扫描与按需载入切换 */
export { createAppLang, type AppLang, type AppLangOptions } from "./app-lang";
/** 模板注册制与视图投影：对话框/选择层/通知层注册表与视图合成 */
export {
  createAppTemplates,
  type AppTemplates,
  type AppTemplatesOptions,
} from "./app-templates";
/** 音视频渲染：端口与渲染器的可变单元格（重启经单元格重建） */
export { createAppMedia, type AppMedia, type AppMediaOptions } from "./app-media";
/** 舞台元素层：元素表渲染与挂载后渲染监听 */
export {
  createAppElementLayer,
  type AppElementLayerOptions,
} from "./app-element-layer";
/** 事件落点与舞台命令：提示条、叙事事件、舞台点击与选项/输入转发 */
export { createAppEvents, type AppEvents, type AppEventsOptions } from "./app-events";
/** 历史聚合：快照筛选、NVL 块化与回溯收口 */
export { createAppHistory, type AppHistory, type AppHistoryOptions } from "./app-history";
/** 引擎生命周期：构造、订阅接线、整体重建与订阅解除 */
export {
  createAppEngineLife,
  type AppEngineLife,
  type AppEngineLifeOptions,
} from "./app-engine";
/** 帧驱动表现与 rAF 帧循环 */
export { createAppFrame, type AppFrame, type AppFrameOptions } from "./app-frame";
/** 玩家偏好与键位映射装配 */
export { createAppPrefs, type AppPrefs, type AppPrefsOptions } from "./app-prefs";
/** 槽位面板：存/读共用面板的打开与点选 */
export { createAppSlots, type AppSlots, type AppSlotsOptions } from "./app-slots";
/** 舞台元素层：元素表渲染与动作分流 */
export {
  createElementLayer,
  type ElementEnginePort,
  type ElementLayer,
  type ElementLayerOptions,
} from "./elements";
/** 帧驱动表现：元素动画 / 全屏转场 / 屏幕震动（补齐节点存在性与转场清理） */
export { createHostEffects, type HostEffectsOptions } from "./effects";
/** 帧循环接线：rAF 帧源 + 每帧顺序 */
export { startHostFrameLoop, type HostFrameLoopOptions } from "./frame-loop";
/** 历史面板：条目过滤与 NVL 块聚合 */
export {
  buildHistoryBlocks,
  filterHistoryEntries,
  type HistoryBlock,
  type HistoryEntry,
} from "./history-panel";
/** 演示玩法系统「极简 WASD 行走」 */
export {
  createInteractionWalk,
  DEFAULT_WALK_SPEED_PX_PER_SEC,
  DEFAULT_WALK_TARGET_PX,
  type InteractionWalkOptions,
  type WalkContext,
  type WalkFactory,
} from "./interaction-walk";
/** 键位面板：按键匹配、捕获与显示 */
export {
  createKeybindingPanel,
  type KeybindingPanel,
  type KeybindingPanelOptions,
} from "./keybinding-panel";
/** 层 z：实例覆盖 → 工程层默认 → 内建三级链 */
export {
  createLayerZController,
  type LayerZController,
  type LayerZControllerOptions,
} from "./layer-z";
/** 演示小游戏工厂「点够指定次数」 */
export {
  createClick3Demo,
  DEFAULT_CLICK3_TARGET,
  type Click3DemoOptions,
} from "./minigame-demo";
/** 叙事事件落点：提示条、读档诊断与错误横幅 */
export {
  createNarrativeEvents,
  type NarrativeEventOptions,
  type NarrativeEvents,
} from "./narrative-event";
/** 叙事视图状态：状态键 → 视图意图 → 响应式字段 */
export {
  createNarrativeState,
  type MenuOption,
  type NarrativeState,
  type NarrativeStateOptions,
} from "./narrative-state";
/** 提示条：驻留时长与摘除 */
export { createNotices, type Notice, type NoticeOptions, type Notices } from "./notices";
/** 偏好面板：音量、静音、字速、方向、全屏 */
export {
  createPreferencesPanel,
  PREF_CHANNELS,
  type PreferencesPanel,
  type PreferencesPanelOptions,
} from "./preferences-panel";
/** 槽位面板：清单与逐槽快照 → 可渲染视图 */
export {
  loadSlotViews,
  parseSlotMeta,
  type SlotPanelMode,
  type SlotPanelOptions,
  type SlotView,
} from "./slot-panel";
