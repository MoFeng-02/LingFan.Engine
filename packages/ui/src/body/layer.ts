/**
 * 身体层：把 `SYS.body` 的原始值选成这一屏要渲染的组件，并连同环境一起交给渲染树。
 *
 * 与元素层是两条通道：元素层画的是叠加在画面上的元素（`__elements`），身体层画的是
 * 「这一屏由谁画」的单槽（`__body`）——同一列只会有一个身体，所以这里产出单个结果。
 *
 * 选什么、选不到怎么办都归 `selectBody` 判，本文件只做两件事：按名字查宿主生成的
 * 组件表，以及把 `props` 与环境拼成组件入参。挂载与卸载不在这里做：组件由宿主的
 * 渲染树持有，删容器子节点会绕开框架的销毁流程，状态与副作用都会漏。
 *
 * 表里没有这个名字属于 fail-closed：不静默跳过（作者写了身体却看不见，无从下手），
 * 也不抛错（一个笔误会黑掉整屏），而是经 `onError` 上报给宿主，本屏不渲染身体。
 * 上报口是普通回调而不是某个框架的响应式引用——写错误条还是打控制台归宿主决定。
 */
import { SYS, type SceneEnv, type StoryEngine } from "@lingfan-engine/core";
import { selectBody } from "./selection.ts";

/** 一个可直接铺进渲染树的身体：组件、它的名字（用于 `:key`）、合并后的入参 */
export interface BodyView {
  /** 身体名 = `SYS.body.name` = `src/scenes/` 下的目录名 */
  readonly name: string;
  /** 组件对象：Vue 形态交给 `<component :is>`，本域不解释它 */
  readonly component: unknown;
  /** 声明里写的 props 与环境（`env`）合并后的入参 */
  readonly props: Readonly<Record<string, unknown>>;
}

/** 身体层装配入参 */
export interface BodyLayerOptions {
  /** 宿主生成的「名字 → 组件」表（构建期产物，键就是 `SYS.body.name`） */
  table: Readonly<Record<string, unknown>>;
  /** 交给每个身体的运行环境（读状态、提意图、读舞台） */
  env: SceneEnv;
  /** 诊断上报口：表里缺组件时把整句诊断交给宿主 */
  onError: (message: string) => void;
  /** 引擎实例取用（重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 选出/清空这一屏的身体时回调；宿主据此更新渲染树 */
  onSelect: (view: BodyView | null) => void;
}

/** 身体层句柄 */
export interface BodyLayer {
  /** 重新读一次 `SYS.body` 并交出新结果（无身体时交出 `null`） */
  render(): void;
  /** 放手：此后 `render()` 不再回调宿主 */
  dispose(): void;
}

/**
 * 装配身体层。
 *
 * `render()` 只在状态真的变了时才被调用（宿主订阅 `SYS.body` 后转发），因此这里不做
 * 去重比较：把「结果相同就不回调」写成引用比较，反而会在状态往返后留下旧身体。
 */
export function createBodyLayer(options: BodyLayerOptions): BodyLayer {
  const { table, env, onError, getEngine, onSelect } = options;
  let disposed = false;

  function render(): void {
    if (disposed) return;
    const selection = selectBody(getEngine().get(SYS.body), table, (name) => {
      onError(
        `身体组件未注册：${name}（fail-closed：需在 src/scenes/${name}/${name}.* 声明并重新构建）`,
      );
    });
    if (selection === null) {
      onSelect(null);
      return;
    }
    onSelect({
      name: selection.name,
      component: selection.component,
      props: { ...selection.props, env },
    });
  }

  function dispose(): void {
    disposed = true;
  }

  return { render, dispose };
}
