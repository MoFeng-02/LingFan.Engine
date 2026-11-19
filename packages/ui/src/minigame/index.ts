/** 小游戏渲染域出口：注册表 + 挂载分支（宿主按名字取用实现，渲染层不内建任何小游戏）。 */
export { createMinigameRegistry, type MinigameRegistry } from "./registry";
export {
  abortSignalOf,
  handleMinigameMount,
  type MinigameMountDeps,
} from "./mount";
