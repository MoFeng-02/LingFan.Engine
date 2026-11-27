/**
 * 列身体层（React 形态）：把当前列的身体组件渲染成这一屏。
 *
 * 与 `UiHost` 的分工：挂载层是「叠加在列上的多个 UI」，身体层是「这一列自己的屏」，
 * 一列只有一个身体。两条边界与挂载层同口径：
 * 1. **值从哪来**：`bodyStore` 由组合根喂（`bootHost` 的 `onBody`），这里用
 *    `useSyncExternalStore` 订阅——React 的并发渲染要求外部值的读取是「快照式」的。
 *    自己再订阅一次引擎的话，退订就有两份实现，漏一份会在拆掉页面后继续写渲染树。
 * 2. **选择已在展示层做完**：`createBodyLayer` 已按 `SYS.body.name` 查表、注入 `env`、
 *    把查不到的名字走诊断出口——这里拿到的就是要渲染的视图，不再自己查表、不再自报缺名。
 *
 * `key` 取身体名：同名更新不重挂（组件内部状态原地保留），换名才整份换身体。
 */
import { createElement, useSyncExternalStore } from "react";
import { bodyStore } from "./scenes";

export function BodyHost() {
  const view = useSyncExternalStore(
    bodyStore.subscribe,
    bodyStore.snapshot,
    bodyStore.snapshot,
  );
  if (view === null) return null;
  return createElement(view.component as never, {
    key: view.name,
    ...view.props,
  });
}
