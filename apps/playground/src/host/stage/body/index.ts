/**
 * 身体层子域出口（唯一出口）：选择与渲染回调、运行环境、宿主装配三件。
 */
export type { BodyLayer, BodyLayerOptions, BodyView } from "./body.ts";
export { createBodyLayer } from "./body.ts";
export type { AppBodyLayer, AppBodyLayerOptions } from "./app-body.ts";
export { createAppBodyLayer } from "./app-body.ts";
export type { SceneEnvOptions, SceneStageState } from "./env.ts";
export { createSceneEnv } from "./env.ts";
