/** 契约出口（模块单一公共入口）：按功能域分文件，消费方只从这里取契约。 */
export * from "./story/index.ts";
export * from "./runtime/index.ts";
export * from "./media/index.ts";
export * from "./save.ts";
export * from "./platform/index.ts";
export * from "./host.ts";
export * from "./preferences.ts";
export * from "./minigame.ts";
export * from "./shell.ts";
export * from "./element.ts";
export * from "./extension.ts";
export * from "./game.ts";
export * from "./param-direction.ts";
export * from "./guard.ts";
export * from "./messages.ts";
export * from "./text.ts";
export * from "./project.ts";

// 判定函数实现位于 shared：此处转发，保持既有导入路径可用。
export * from "../shared/index.ts";
