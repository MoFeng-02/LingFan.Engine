/**
 * 引擎接线族出口：把引擎生命周期、事件表与文案接到 playground 宿主。
 *
 * 轴 = 引擎接线四件——生命周期（`app-engine.ts`）、事件表（`app-events.ts`）、
 * 文案（`engine-texts.ts`）、中止信号（`abort-signal.ts`）。
 */
export { abortSignalOf } from "./abort-signal.ts";
export type { AppEngineLife, AppEngineLifeOptions } from "./app-engine.ts";
export { createAppEngineLife } from "./app-engine.ts";
export type { AppEvents, AppEventsOptions } from "./app-events.ts";
export { createAppEvents } from "./app-events.ts";
export { playgroundEngineTexts } from "./engine-texts.ts";
