/**
 * 元素树接线：把舞台元素渲染进元素层，并把元素的交互语义翻译成引擎调用。
 *
 * 元素渲染本身归元素域（`renderElementTree`）；本模块只提供三样宿主侧能力：
 * 交互激活（nav / ops / cmd 三条语义）、`disabled` 表达式求值、未注册类型上报。
 * 求值一律经引擎的插值入口，本层不解析表达式语法——语法归核心层。
 */
import type { ElementInstance, StoryEngine } from "@lingfan/engine";
import { resolveElementAction } from "../element/interaction";
import { renderElementTree } from "../element/render";
import type { ElementRegistry } from "../element/registry";

/** 元素 `cmd` 命令处理器（未注册 = fail-closed 上报） */
export type ElementCommandHandler = (
  value: string | undefined,
  element: ElementInstance,
) => void;

/**
 * 元素树渲染的装配输入。除 `engine` 外全部可选或可替换——
 * `registry` 换掉即换元素类型全集，`commands` 不传则元素上的 `cmd` 一律走 fail-closed 上报。
 */
export interface ElementTreeDeps {
  /** 元素渲染器注册表（36 类型全集，或宿主替换的实现） */
  registry: ElementRegistry;
  /** 元素层（元素树的渲染目标） */
  container: HTMLElement;
  engine: StoryEngine;
  /** 宿主注册的元素命令表 */
  commands?: Map<string, ElementCommandHandler>;
  /** 资源解析（元素 source/src/path → URL） */
  resolveResource?: (path: string) => string | undefined;
  /** 上报（错误与 fail-closed 诊断） */
  report: (message: string) => void;
}

/**
 * 元素树接线器：宿主只需调 `render` 提交一帧元素列表，交互语义由本层消化。
 * 两个方法都是无状态的——元素数据每次由调用方给全，本层不缓存上一帧。
 */
export interface ElementTree {
  /** `disabled` 表达式求值（返回 `null` = 求值失败，表达式语法归核心层） */
  evalDisable(expression: string): boolean | null;
  /** 整体重渲元素树（每次调用重建，不做增量 diff） */
  render(elements: readonly ElementInstance[]): void;
}

/**
 * 造一个元素树接线器。
 *
 * `evalDisable` 与 `activate` 共用同一套判定（同一组属性、同一个求值函数），
 * 因此「看起来能点」与「点下去真的做了」不会分叉。元素列表逐帧传入、整体重渲，
 * 本层不持有元素状态。
 */
export function createElementTree(deps: ElementTreeDeps): ElementTree {
  const { engine } = deps;

  function evalDisable(expression: string): boolean | null {
    const out = engine.interpolate(expression);
    if (out === "true") return true;
    if (out === "false") return false;
    return null;
  }

  function activate(element: ElementInstance): void {
    const action = resolveElementAction(element.props, { evalDisable });
    if (action.kind === "nav") {
      engine.navigate(action.target);
      return;
    }
    if (action.kind === "ops") {
      if (!engine.runElementOps(action.ops)) {
        deps.report("元素动作执行失败（等待/位置类 op 与畸形负载会被拒绝）");
      }
      return;
    }
    if (action.kind !== "cmd") return;
    const handler = deps.commands?.get(action.name);
    if (handler === undefined) {
      deps.report(
        `元素命令未注册：${action.name}（fail-closed：需宿主经命令注册表提供）`,
      );
      return;
    }
    handler(
      action.value === undefined ? undefined : engine.interpolate(action.value),
      element,
    );
  }

  return {
    evalDisable,
    render(elements: readonly ElementInstance[]): void {
      // 交互元素的 pointer-events 由渲染器自行恢复（有交互动词的节点由绑定层
      // 置 cursor:pointer + pointer-events:auto）——本层不重判第二遍。
      renderElementTree({
        registry: deps.registry,
        container: deps.container,
        elements,
        activate,
        evalDisable,
        resolveResource: deps.resolveResource,
        onUnknownType: (type) =>
          deps.report(`元素类型未注册：${type}（fail-closed：不伪造渲染）`),
      });
    },
  };
}
