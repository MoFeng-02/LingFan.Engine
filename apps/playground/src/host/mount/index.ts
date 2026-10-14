/**
 * 挂载域出口（唯一出口）：外部系统挂载分支与注册表装配。
 *
 * `App.vue` 的事件分流按 kind 调这里的三条分支；注册表与输入域由
 * `createMountRegistries` 一处装配。分支彼此独立、只经依赖注入取宿主侧事实。
 */
export { createMountRegistries, type MountRegistries } from "./registries";
export { handleMinigameMount, type MinigameMountDeps } from "./minigame";
export {
  handleInteractionMount,
  type InteractionMountDeps,
} from "./interaction";
export {
  createExtensionMountHandler,
  type ExtensionMountHandler,
  type ExtensionOverlay,
} from "./extension";
