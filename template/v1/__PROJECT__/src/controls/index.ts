/**
 * 宿主控制面的宿主侧出口。
 *
 * 组合根在 `onControls` 回调里把句柄喂进 `controlsStore`，框架形态的挂载组件只从这里取，
 * 不在自己的入口里各写一份订阅。
 */
export { controlsStore } from "./store";
