/**
 * 浏览器参考宿主的宿主层出口（唯一出口）：只转发组合根与面板真正从这里取的符号。
 *
 * 装配叶子按职责分七个域：engine 是引擎生命周期与事件装配；narrative 是叙事
 * 视图与语言模板；stage 是舞台呈现（元素层/媒体/帧驱动）；panels 是偏好与
 * 存读档面板；assets 是字体与多语言；demos 是演示玩法；mount 是引擎让出控制权
 * 的三类挂载分支。装配叶子彼此不互相依赖组合根：需要引擎、端口或 DOM 句柄的
 * 地方一律以具名注入（函数或接口）取得，于是每个叶子都能单独读、单独测，换
 * 宿主时只需换接线。组合根本身（`main.ts`）不属于这里——那是装配顺序的归属地。
 * 叶子之间的协作走深引，不经本文件中转（保持出口面 = 消费面，零转发冗余）。
 */

/** —— 装配工厂（App.vue 组合根消费）—— */
export { createAppNarrative } from "./narrative/app-narrative";
export { createAppLang } from "./assets/app-lang";
export { createAppTemplates } from "./narrative/app-templates";
export { createAppMedia } from "./stage/app-media";
export { createAppElementLayer } from "./stage/app-element-layer";
export { createAppEvents } from "./engine/app-events";
export { createAppHistory } from "./panels/app-history";
export { createAppEngineLife } from "./engine/app-engine";
export { createAppFrame } from "./stage/app-frame";
export { createAppPrefs } from "./panels/app-prefs";
export { createAppSlots } from "./panels/app-slots";

/** —— 面板类型（App/*.vue 消费）—— */
export type { HistoryBlock, MenuOption, SlotPanelMode, SlotView } from "@lingfan/shell";
