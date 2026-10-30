/**
 * 屏幕判定与切换：引擎不认识「启动界面」，宿主负责说此刻该画哪一屏。
 *
 * 这一层刻意很小：判定（列 → 屏）、存档挑选（哪一槽是「继续」）、订阅点（值谁推、
 * 谁订阅），以及把三者折成一份渲染输入。画法不在这里——原生造 DOM、Vue / React 交组件。
 */
export {
  hostScreenOf,
  type HostScreen,
  type HostScreenInput,
} from "./model.ts";
export { continueSlot, latestSave } from "./continue.ts";
export { firstGameColumn } from "./entry.ts";
export { createScreenStore, type ScreenStore } from "./store.ts";
export {
  sameScreenView,
  screenViewOf,
  type ContinueHint,
  type ScreenView,
  type ScreenViewInput,
} from "./view.ts";
