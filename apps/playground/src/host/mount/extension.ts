/**
 * 扩展 op 等待接管：展示态编排与模板共用 `@lingfan-engine/ui` 一份实现，本文件只做转发。
 * 覆盖层怎么画与「确认」触发 resolve 归 `App/ExtensionOverlayCard.vue` 的消费方（App.vue）。
 */
export {
  createExtensionMountHandler,
  type ExtensionMountDeps,
  type ExtensionMountHandler,
  type ExtensionOverlay,
} from "@lingfan-engine/ui";
