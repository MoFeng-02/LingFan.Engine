/** 契约出口（模块单一公共入口）：按功能域分文件，消费方只从这里取契约。 */
export * from "./story";
export * from "./runtime";
export * from "./media";
export * from "./save";
export * from "./platform";
export * from "./host";
export * from "./preferences";
export * from "./minigame";
export * from "./shell";
export * from "./element";
export * from "./extension";
export * from "./game";
export * from "./guard";
export * from "./text";
export * from "./project";

// 判定函数实现已下沉到 shared：此处转发，保持既有导入路径可用。
export * from "../shared";
