/**
 * 列身体域出口（唯一出口）：把引擎写的 `SYS.body` 变成「这一屏渲染谁、带什么入参」。
 *
 * 选择是纯判定，环境与身体层只转发引擎与回调，不碰 DOM、不认识框架——三种宿主形态
 * 各自把结果落到自己的渲染树上。判据因此可以脱离浏览器跑：同一对输入必得同一份结果。
 */
export {
  bodyCapabilitiesOf,
  selectBody,
  type BodySelection,
} from "./selection.ts";
export { createSceneEnv } from "./env.ts";
export type { SceneEnvOptions, SceneStageState } from "./env.ts";
export { createBodyLayer } from "./layer.ts";
export type { BodyLayer, BodyLayerOptions, BodyView } from "./layer.ts";
export { createBodyStore } from "./store.ts";
export type { BodySource, BodyStore } from "./store.ts";
