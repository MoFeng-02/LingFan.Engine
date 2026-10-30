/**
 * 原生形态的挂载渲染器：把 `SYS.mounts` 落到真实 DOM 上。
 *
 * 框架形态靠各自的响应式系统重渲染，原生形态没有那层——它必须自己算差量：
 * 谁新出现就造节点挂上，谁消失了就拆掉，谁只是换了入参就**整份重挂**（不是改属性）。
 * 差量与投影都不在这里（`@lingfan-engine/ui` 的 mount 域），本文件只做三件 DOM 事：
 * 追加、移除、调拆除钩子。
 *
 * 隐藏 = 从渲染树移除，不是 `display: none`：容器里那一项真的不在了，
 * 组件自己的定时器、订阅、媒体元素随拆除钩子一起停掉。
 *
 * 挂载失败一律 fail-closed 上报、不渲染那一条：一个 UI 写错不该黑掉整屏，
 * 也不该静默消失——作者要能看见「哪个名字没挂上」。
 */
import {
  mountProps,
  planMounts,
  visibleMounts,
  type MountPlan,
} from "@lingfan-engine/ui";
import { resolveNativeFactory, type NativeUiInstance } from "./table";

/** 渲染器输入：容器、生成物表、诊断出口 */
export interface NativeMountRendererOptions {
  /** 挂载容器：子节点就是当前可见的 UI（按挂载次序排列） */
  container: HTMLElement;
  /** 「名字 → 工厂」表（生成物 `uis`） */
  table: Readonly<Record<string, unknown>>;
  /** 诊断出口：挂不上、拆除失败都从这里出去，不吞 */
  reportError(message: string): void;
}

/** 渲染器：喂状态、拆干净 */
export interface NativeMountRenderer {
  /** 推进到新状态（首帧传 `undefined` 也可） */
  sync(raw: unknown): void;
  /** 拆掉全部已挂 UI 并退订钩子；之后 `sync` 不再有效 */
  dispose(): void;
}

/**
 * 造一个原生挂载渲染器。
 *
 * 已挂的节点**不重排**：顺序由首次挂载决定。重排会让组件内部状态、滚动位置与焦点
 * 在每次状态变化时抖一下——那份收益（与框架形态顺序完全一致）不值这个代价。
 */
export function createNativeMountRenderer(
  options: NativeMountRendererOptions,
): NativeMountRenderer {
  const mounted = new Map<string, NativeUiInstance>();
  /** 已上报过的「挂不上」名字：同一条诊断不每帧刷屏，名字消失后再出现会重新报 */
  const reported = new Set<string>();
  let previous: unknown = undefined;
  let disposed = false;

  function unmountOne(name: string): void {
    const instance = mounted.get(name);
    if (instance === undefined) return;
    mounted.delete(name);
    try {
      instance.dispose?.();
    } catch (error) {
      options.reportError(`UI ${name} 拆除失败：${String(error)}`);
    }
    if (instance.element.parentNode === options.container) {
      options.container.removeChild(instance.element);
    }
  }

  function mountOne(name: string, raw: unknown): void {
    const factory = resolveNativeFactory(options.table, name);
    if (factory === undefined) {
      if (!reported.has(name)) {
        reported.add(name);
        options.reportError(
          `找不到 UI 的工厂：${name}（生成物 uis 里没有这个名字，或它不是函数——原生形态的 UI 必须导出工厂）`,
        );
      }
      return;
    }
    let instance: NativeUiInstance;
    try {
      instance = factory(mountProps(raw, name) ?? {});
    } catch (error) {
      options.reportError(`UI ${name} 挂载失败：${String(error)}`);
      return;
    }
    reported.delete(name);
    mounted.set(name, instance);
    options.container.appendChild(instance.element);
  }

  function apply(plan: MountPlan, raw: unknown): void {
    // 先卸再挂：同时存在新旧两份时，焦点、滚动位置与无障碍树都会出现两个答案
    for (const name of plan.unmount) unmountOne(name);
    for (const name of plan.update) unmountOne(name);
    for (const name of plan.update) mountOne(name, raw);
    for (const name of plan.mount) mountOne(name, raw);
    // 已上报过的名字若已不可见，忘掉它：下次再挂同名的失败要能重新出声
    const visible = new Set(visibleMounts(raw));
    for (const name of [...reported]) {
      if (!visible.has(name)) reported.delete(name);
    }
  }

  return {
    sync(raw: unknown): void {
      if (disposed) return;
      const plan = planMounts(previous, raw);
      previous = raw;
      apply(plan, raw);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const name of [...mounted.keys()]) unmountOne(name);
      reported.clear();
    },
  };
}
