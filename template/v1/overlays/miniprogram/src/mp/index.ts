/**
 * 小程序宿主的对外出口：页面与其它入口只从这里取件，别处不允许深引内部模块。
 */
export * from "./platform.ts";
export * from "./view.ts";
export * from "./surface.ts";
export * from "./video-surface.ts";
export * from "./slots.ts";
export * from "./host.ts";
