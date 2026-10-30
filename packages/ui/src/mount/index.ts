/**
 * UI 挂载域出口（唯一出口）：把 `SYS.mounts` 翻译成「该渲染谁、带什么入参、和上一帧比变了几件事」。
 *
 * 这一域只做纯投影、差量与选择，不碰 DOM、不认识框架——三种宿主形态（原生 DOM / Vue / React）
 * 各自把结果落到自己的渲染树上。判据因此可以脱离浏览器跑：同一对输入必得同一份结果。
 *
 * 三件事刻意分开，因为三种宿主需要的粒度不同：
 * - `visibleMounts` / `mountProps` / `mountEntryOf` 回答「现在是什么样」，声明式宿主按它渲染即可；
 * - `selectMounts` / `missingMounts` 再加一层「名字 → 组件」查表与取不到的 fail-closed；
 * - `planMounts` 回答「比上次变了什么」，命令式宿主需要它才知道卸谁、挂谁；
 * - `createMountStore` 是订阅通路：三条形态共用同一份值，退订只有一处实现。
 */
export {
  mountEntryOf,
  mountProps,
  visibleMounts,
  type MountEntry,
  type MountTable,
} from "./projection.ts";
export { planMounts, type MountPlan } from "./plan.ts";
export {
  missingMounts,
  selectMounts,
  type MountSelection,
} from "./selection.ts";
export {
  createMountStore,
  type MountSource,
  type MountStore,
} from "./store.ts";
