/**
 * 本目录是 `packages/ui` 内**唯一**允许出现 DOM 类型与 DOM 全局的目录。
 *
 * 与 `packages/ui/src/host/index.ts` 同一口气的规则：其余目录一律只产出 `RenderSpec`；
 * 需要碰 DOM 的地方经 `RenderPort` 完成到这里，别的平台（小程序）在同一位置换成自己的物化器。
 */
import type {
  RenderEvent,
  RenderEventPatch,
  RenderKind,
  RenderPort,
  RenderPropValue,
  RenderSpec,
} from "../element/spec";

/** 中立词表 → Web 标签（`text` 落在 `div` 上：文本族的落地形态一直是 `div`） */
const KIND_TAG: Readonly<Record<RenderKind, string>> = {
  box: "div",
  text: "div",
  image: "img",
  media: "video",
  input: "input",
  slider: "input",
  checkbox: "input",
  action: "button",
};

/** 写属性：顺序即 `props` 的插入顺序（`crossOrigin` 须先于 `src`，见图像族渲染器） */
function applyProps(
  node: HTMLElement,
  props: Readonly<Record<string, RenderPropValue>>,
): void {
  const target = node as unknown as Record<string, RenderPropValue>;
  for (const [key, value] of Object.entries(props)) {
    target[key] = value;
  }
}

function applyPatch(node: HTMLElement, patch: RenderEventPatch): void {
  if (patch.style !== undefined) Object.assign(node.style, patch.style);
  if (patch.props !== undefined) applyProps(node, patch.props);
}

function bindEvents(
  node: HTMLElement,
  events: readonly RenderEvent[] | undefined,
): void {
  for (const event of events ?? []) {
    node.addEventListener(event.on, (domEvent) => {
      if (event.stopPropagation === true) domEvent.stopPropagation();
      const patch = event.handler?.();
      if (patch !== undefined) applyPatch(node, patch);
    });
  }
}

/** 把一棵描述树物化成 DOM 节点（含整棵子树与事件） */
export function materialize(spec: RenderSpec): HTMLElement {
  const node = document.createElement(KIND_TAG[spec.kind]);
  if (spec.className !== undefined) node.className = spec.className;
  if (spec.style !== undefined) Object.assign(node.style, spec.style);
  if (spec.text !== undefined) node.textContent = spec.text;
  if (spec.html !== undefined) node.innerHTML = spec.html;
  if (spec.props !== undefined) applyProps(node, spec.props);
  // 帧驱动定位锚（动画按 id 找节点；无 dataset 的环境自动跳过）
  if (spec.id !== undefined && node.dataset !== undefined) {
    node.dataset.lfId = spec.id;
  }
  for (const child of spec.children ?? []) node.appendChild(materialize(child));
  bindEvents(node, spec.events);
  return node;
}

/**
 * 把一个元素当作渲染根，造出 Web 版渲染端口。
 *
 * 每次调用产出独立的端口对象（无状态包装），因此同一元素重复取端口不会串扰。
 */
export function createDomRenderPort(element: HTMLElement): RenderPort {
  return {
    clear(): void {
      element.innerHTML = "";
    },
    mount(spec: RenderSpec): void {
      element.appendChild(materialize(spec));
    },
  };
}
