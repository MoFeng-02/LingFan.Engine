/**
 * UI 挂载层（React 形态）：把 `SYS.mounts` 里可见的 UI 铺成子组件。
 *
 * 与 Vue 形态逐条对等，只是取值的接缝换了：
 * 1. **值从哪来**：`mountStore` 由组合根喂（`bootHost` 的 `onMounts`），这里用
 *    `useSyncExternalStore` 订阅——React 的并发渲染要求外部值的读取是「快照式」的，
 *    自己 `useState` + `useEffect` 会在首帧读到旧值。
 * 2. **表从哪来**：`uis` 来自生成物（`src/gen/ui_register.g.ts`），键就是目录名，
 *    不做 `import.meta.glob`——那会把 `src/ui/` 下的文件全部静态拉进包。
 * 3. **隐藏 = 不渲染**：列表就是可见集合，不可见的组件不在渲染树上，它的副作用与
 *    定时器随卸载一起清（不是 `display:none`）。
 *
 * 组件由 React 自己创建，所以挂载点的父子关系归 React——组合根不该再往这个容器里写节点。
 */
import {
  createElement,
  Fragment,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { missingMounts, selectMounts } from "@lingfan-engine/ui";
import { controlsStore } from "./controls";
import { mountStore, uis } from "./mounts";

/** 生成物里没有的名字只报一次：按帧重渲染会把它刷成噪音，反而看不见真问题 */
const reported = new Set<string>();

export function UiHost() {
  const raw = useSyncExternalStore(
    mountStore.subscribe,
    mountStore.snapshot,
    mountStore.snapshot,
  );
  /**
   * 操作句柄：来自组合根而不是故事值。
   *
   * 它与 `props` 分属两条通道——`props` 是故事命令写下的值（随存档、必须 JSON 安全），
   * 句柄含函数、不进快照，所以单独订阅一格再作为 prop 发给每个挂载组件。
   */
  const controls = useSyncExternalStore(
    controlsStore.subscribe,
    controlsStore.snapshot,
    controlsStore.snapshot,
  );
  const items = useMemo(() => selectMounts(raw, uis), [raw]);

  useEffect(() => {
    for (const name of missingMounts(raw, uis)) {
      if (reported.has(name)) continue;
      reported.add(name);
      console.error(
        `[ui] 生成物 uis 里没有 ${name}，这条挂载被跳过——构建期本应拦住越界的 UI 名`,
      );
    }
  }, [raw]);

  // 外层用 Fragment 而不是 null：`createElement(null, …)` 不是合法调用形态，
  // 类型上也过不去（第一个参数只接受标签名或组件）。
  return createElement(
    Fragment,
    null,
    ...items.map((item) =>
      createElement(item.component as never, {
        key: item.name,
        ...item.props,
        controls,
      }),
    ),
  );
}
