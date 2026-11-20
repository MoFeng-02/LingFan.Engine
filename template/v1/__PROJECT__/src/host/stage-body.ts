/**
 * 列身体的宿主接线：把引擎写的 `SYS.body` 落成「这一屏渲染谁」。
 *
 * 选择与环境都在展示层（`@lingfan-engine/ui` 的 body 域，框架无关）：本文件只做装配——
 * 造环境、接身体层、把选出的视图落到本形态的渲染树上。两条落法与挂载层同口径：
 * - **原生形态**（给了容器）：单槽渲染器，视图变了就整份重挂（原生工厂没有改属性通道）；
 * - **框架形态**（给了 `onBody`）：只把视图交给组合根，父子关系归框架的渲染树管。
 *
 * 两样都不给即 `body` 只改状态、没有组件出现（与 `mount` 缺省行为一致）。
 * 容器与 `onBody` 互斥：给了 `onBody` 就走框架落法（与挂载层同一优先级口径）——
 * 往框架管的容器里再写子节点会与它的渲染树打架。
 */
import {
  createBodyLayer,
  createSceneEnv,
  type BodyView,
  type SceneStageState,
} from "@lingfan-engine/ui";
import type {
  HostCapability,
  HostControls,
  SceneEnv,
  StoryEngine,
} from "@lingfan-engine/core";
import { resolveNativeFactory, type NativeUiInstance } from "./mount/table";

/** 接线输入：引擎与舞台读面、生成物表、控制面、诊断出口，以及二选一的落法 */
export interface BodyWiringOptions {
  /** 引擎读面（身体层经它读 `SYS.body`、环境经它读写状态） */
  getEngine: () => StoryEngine;
  /** 舞台几何读面（环境的 `stage()` 经它取视口与布局） */
  readStage: () => SceneStageState;
  /** 「名字 → 组件」表（生成物 `scenes`） */
  table: Readonly<Record<string, unknown>>;
  /** 宿主控制面（原生工厂的第二参；框架形态经 props 里的 env 交互，用不到它） */
  controls: HostControls;
  /** 诊断出口：查不到名字、挂不上、拆除失败都从这里出去，不吞 */
  reportError: (message: string) => void;
  /** 原生形态的身体容器（可选）：给了就建单槽渲染器 */
  container?: HTMLElement | null;
  /** 框架形态的落法（可选）：给了就只交视图，不建原生渲染器 */
  onBody?: (view: BodyView | null) => void;
  /**
   * 宿主能力集（可选）：给了就在装配层比对身体组件声明的所需能力，缺能力 fail-closed
   * （诊断 + 不渲染）；不给即不比对（行为与既往一致）。桌面/浏览器宿主声明全量能力。
   */
  hostCapabilities?: readonly HostCapability[];
}

/** 接线句柄：环境（供需要它的消费方）、渲染入口、拆除 */
export interface BodyWiring {
  /** 场景环境：组件经它读写引擎状态（身体层已把它注入 props） */
  env: SceneEnv;
  /** 读一次 `SYS.body` 并落到渲染树（订阅回调里调它） */
  render(): void;
  /** 拆掉已挂身体并退订；之后 `render` 不再有效 */
  dispose(): void;
}

/**
 * 接上列身体。返回 `null` 表示本形态不渲染身体（`body` 只改状态）。
 *
 * 订阅不在这里建立——由 `engine-wiring` 统一持有（首帧喂一次 + `SYS.body` 变化回调），
 * 与挂载层同一处退订，避免订阅散落在多个文件里漏掉注销。
 */
export function wireBodyLayer(options: BodyWiringOptions): BodyWiring | null {
  const {
    getEngine,
    readStage,
    table,
    controls,
    reportError,
    hostCapabilities,
  } = options;
  const env = createSceneEnv({ getEngine, readStage });

  // 框架形态：只把视图交给组合根，渲染树归框架管
  if (options.onBody !== undefined) {
    const onBody = options.onBody;
    const layer = createBodyLayer({
      table,
      env,
      onError: reportError,
      getEngine,
      onSelect: onBody,
      hostCapabilities,
    });
    return {
      env,
      render: (): void => layer.render(),
      dispose: (): void => layer.dispose(),
    };
  }

  const container = options.container ?? null;
  if (container === null) return null;
  // 收窄成非空常量再交给闭包：原生渲染器全程持有同一个容器节点
  const host: HTMLElement = container;

  // 原生形态：单槽渲染器。视图变了整份重挂（与挂载渲染器的 update 同口径）
  let mounted: { name: string; instance: NativeUiInstance } | null = null;
  /** 已上报过的「挂不上」名字：同一条诊断不刷屏，名字消失后再出现会重新报 */
  const reported = new Set<string>();

  function unmount(): void {
    if (mounted === null) return;
    const { name, instance } = mounted;
    mounted = null;
    try {
      instance.dispose?.();
    } catch (error) {
      reportError(`身体 ${name} 拆除失败：${String(error)}`);
    }
    if (instance.element.parentNode === host) {
      host.removeChild(instance.element);
    }
  }

  function applyNative(view: BodyView | null): void {
    // 不再是当前身体的名字，忘掉它的已上报标记：下次再挂同名的失败要能重新出声
    const current = view === null ? undefined : view.name;
    for (const name of [...reported]) {
      if (name !== current) reported.delete(name);
    }
    // 先卸再挂：同时存在新旧两份时，焦点与无障碍树会出现两个答案
    unmount();
    if (view === null) return;
    const factory = resolveNativeFactory(table, view.name);
    if (factory === undefined) {
      if (!reported.has(view.name)) {
        reported.add(view.name);
        reportError(
          `找不到身体的工厂：${view.name}（生成物 scenes 里没有这个名字，或它不是函数——原生形态的身体必须导出工厂）`,
        );
      }
      return;
    }
    let instance: NativeUiInstance;
    try {
      instance = factory(view.props, controls);
    } catch (error) {
      reportError(`身体 ${view.name} 挂载失败：${String(error)}`);
      return;
    }
    reported.delete(view.name);
    mounted = { name: view.name, instance };
    host.appendChild(instance.element);
  }

  const layer = createBodyLayer({
    table,
    env,
    onError: reportError,
    getEngine,
    onSelect: applyNative,
    hostCapabilities,
  });
  return {
    env,
    render: (): void => layer.render(),
    dispose: (): void => {
      layer.dispose();
      unmount();
    },
  };
}
