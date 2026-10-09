/**
 * 元素树渲染（宿主入口）：清空舞台层 → 逐元素经注册表渲染。
 *
 * fail-closed 约束：**未注册类型不渲染、不伪造**，经 `onUnknownType` 上报宿主
 * （与小游戏注册表同构——小游戏未注册也是上报后保持等待）。
 *
 * 幂等：每次调用整体重建（元素数量有限；避免增量 diff 的复杂度，
 * 帧级高频状态另有其道，见帧驱动文档）。
 */
import type { ElementInstance } from "@lingfan/engine";
import type { ElementRegistry } from "./registry";

/**
 * 一帧元素树的渲染请求：`registry` / `container` / `elements` 必给，
 * 其余三个回调不传即「没有对应的宿主能力」（表现为元素不可点、表达式不求解、资源显示替代文本）。
 */
export interface ElementTreeRenderOptions {
  registry: ElementRegistry;
  container: HTMLElement;
  elements: readonly ElementInstance[];
  /** 交互激活（宿主把元素语义翻译成引擎命令，如 nav → navigate / ops → runElementOps） */
  activate?: (element: ElementInstance) => void;
  /** `disabled` 表达式求值（返回 null = 求值失败；表达式语法归核心层） */
  evalDisable?: (expression: string) => boolean | null;
  /** 资源解析（source/src/path → URL） */
  resolveResource?: (path: string) => string | undefined;
  /** 未注册类型上报（fail-closed；宿主负责可见诊断） */
  onUnknownType?: (type: string) => void;
}

/**
 * 把一帧元素列表渲染进 `container`（先清空，再整棵重建）。
 *
 * 调用方每帧给全量元素——本函数不记上一帧、不做增量对比。未注册类型跳过并上报，
 * 不画占位：宁可少一个节点，也不让内容错误看起来像渲染成功。
 */
export function renderElementTree(options: ElementTreeRenderOptions): void {
  const { container, registry, elements } = options;
  container.innerHTML = "";

  const renderChildren = (
    host: HTMLElement,
    list: readonly ElementInstance[],
  ): void => {
    for (const element of list) renderOne(host, element);
  };

  function renderOne(host: HTMLElement, element: ElementInstance): void {
    const renderer = registry.get(element.type);
    if (renderer === undefined) {
      options.onUnknownType?.(element.type);
      return;
    }
    const node = renderer({
      element,
      renderChildren,
      activate: options.activate,
      evalDisable: options.evalDisable,
      resolveResource: options.resolveResource,
    });
    // 舞台内叠放序（两级叠放：元素之间在 stage 容器内独立比较）
    node.style.zIndex = String(element.z);
    // 帧驱动定位锚（动画按 id 找节点；无 dataset 的环境自动跳过）
    if (node.dataset !== undefined) node.dataset.lfId = element.id;
    host.appendChild(node);
  }

  renderChildren(container, elements);
}
