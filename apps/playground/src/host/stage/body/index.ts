/**
 * 身体层子域出口（唯一出口）：选择、环境与身体层转发公共包，宿主装配留本地。
 *
 * `createSceneEnv` / `createBodyLayer` / `selectBody` 的实现都在
 * `@lingfan-engine/ui`——这里只转发，宿主与测试从哪条路进都拿到同一份。
 */
export type {
  BodyLayer,
  BodyLayerOptions,
  BodySelection,
  BodyView,
  SceneEnvOptions,
  SceneStageState,
} from "@lingfan-engine/ui";
export {
  createBodyLayer,
  createSceneEnv,
  selectBody,
} from "@lingfan-engine/ui";
export type { AppBodyLayer, AppBodyLayerOptions } from "./app-body.ts";
export { createAppBodyLayer } from "./app-body.ts";
