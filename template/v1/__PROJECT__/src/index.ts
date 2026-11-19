/**
 * 组合根注册表出口：把两份「名字 → 组件」表与它们的值格聚合在一个出口。
 *
 * `mounts` 是 UI 挂载层（叠加界面），`scenes` 是列身体（整屏组件）——两者都是
 * 生成物在 `src/**` 的引用点，装配根从这里取表喂给宿主。页面入口仍是 `main.ts`。
 */
export { mountStore, uis } from "./mounts";
export { bodyStore, scenes } from "./scenes";
