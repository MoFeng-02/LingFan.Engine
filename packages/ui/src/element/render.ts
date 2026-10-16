/**
 * 元素树渲染（宿主入口）：清空渲染根 → 逐元素经注册表取描述树 → 交给渲染端口物化。
 *
 * fail-closed 约束：**未注册类型不渲染、不伪造**，经 `onUnknownType` 上报宿主
 * （与小游戏注册表同构——小游戏未注册也是上报后保持等待）。
 *
 * 幂等：每次调用整体重建（元素数量有限；避免增量 diff 的复杂度，
 * 帧级高频状态另有其道，见帧驱动文档）。
 */
import type { ElementInstance } from "@lingfan/engine";
import type { ElementRegistry } from "./registry";
import type { RenderPort, RenderSpec } from "./spec";

/**
 * 一帧元素树的渲染请求：`registry` / `port` / `elements` 必给，
 * 其余三个回调不传即「没有对应的宿主能力」（表现为元素不可点、表达式不求解、资源显示替代文本）。
 *
 * `port` 是宿主注入的渲染端口（Web 侧 `createDomRenderPort`）——渲染器只产出描述树，
 * 平台差异全部完成在端口实现里。
 */
export interface ElementTreeRenderOptions {
  registry: ElementRegistry;
  port: RenderPort;
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
 * 把一帧元素列表渲染进 `port`（先清空，再整棵重建）。
 *
 * 调用方每帧给全量元素——本函数不记上一帧、不做增量对比。未注册类型跳过并上报，
 * 不画占位：宁可少一个节点，也不让内容错误看起来像渲染成功。
 */
export function renderElementTree(options: ElementTreeRenderOptions): void {
  const { port, registry, elements } = options;
  port.clear();

  const renderChildren = (list: readonly ElementInstance[]): RenderSpec[] => {
    const specs: RenderSpec[] = [];
    for (const element of list) {
      const spec = renderOne(element);
      if (spec !== undefined) specs.push(spec);
    }
    return specs;
  };

  function renderOne(element: ElementInstance): RenderSpec | undefined {
    const renderer = registry.get(element.type);
    if (renderer === undefined) {
      options.onUnknownType?.(element.type);
      return undefined;
    }
    const spec = renderer({
      element,
      renderChildren,
      activate: options.activate,
      evalDisable: options.evalDisable,
      resolveResource: options.resolveResource,
    });
    // 舞台内叠放序（两级叠放：元素之间在 stage 容器内独立比较）覆盖作者声明，
    // 帧驱动定位锚挂在根节点上（动画按 id 找节点）
    return {
      ...spec,
      style: { ...spec.style, zIndex: String(element.z) },
      id: element.id,
    };
  }

  for (const spec of renderChildren(elements)) port.mount(spec);
}
