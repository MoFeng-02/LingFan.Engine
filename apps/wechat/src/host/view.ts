/**
 * 渲染树翻译：把 `@lingfan/ui` 的元素描述翻成小程序能绑定的数据树。
 *
 * 小程序没有 DOM，WXML 只能绑数据，所以渲染端口在这里不是「造节点」而是「算数据」：
 * 本文件把描述树算成 `MiniNode[]`，由页面把它送进 setData，再由 WXML 的递归模板
 * 铺开。样式串也在这里拼好（camelCase 键 → CSS 声明），免得模板里再算一遍。
 */
import type { StageLayout } from "@lingfan/shell";
import type { RenderSpec } from "@lingfan/ui";

/** 一个待渲染节点：字段与 WXML 模板一一对应 */
export interface MiniNode {
  /** 同层内稳定键，供模板的 wx:key 用 */
  key: string;
  /** 元素种类（box / text / image / media / input / slider / checkbox / action） */
  kind: string;
  /** 语义类名（具体观感挂在工程样式表的类上） */
  className: string;
  /** 已拼好的行内 CSS 声明串 */
  style: string;
  /** 纯文本内容 */
  text?: string;
  /** 富文本内容（含标记的片段，交给 rich-text 渲染） */
  html?: string;
  /** 媒体地址（图与视频用） */
  src?: string;
  /** 子节点 */
  children?: MiniNode[];
}

/** 把一棵描述树翻成节点树；`path` 是给子节点编键用的前缀 */
export function toMiniNode(spec: RenderSpec, path: string): MiniNode {
  const node: MiniNode = {
    key: spec.id ?? path,
    kind: spec.kind,
    className: spec.className ?? "",
    style: styleText(spec.style),
  };
  if (spec.text !== undefined) node.text = spec.text;
  if (spec.html !== undefined) node.html = spec.html;
  const src = spec.props?.["src"];
  if (typeof src === "string") node.src = src;
  const children = spec.children ?? [];
  if (children.length > 0) {
    node.children = children.map((child, index) =>
      toMiniNode(child, `${path}-${index}`),
    );
  }
  return node;
}

/** 把一棵描述树翻成一层节点（无描述 = 空层） */
export function toMiniTree(spec: RenderSpec | null): MiniNode[] {
  return spec === null ? [] : [toMiniNode(spec, "0")];
}

/**
 * 把舞台布局算成内层容器的行内样式：先按基准尺寸定死舞台，再整体平移与缩放。
 *
 * 变换原点取左上角（见工程样式表），因此平移量与缩放量的口径与布局计算一致：
 * 先缩放再平移，偏移就是缩放后内容与视口的左上角距离。
 */
export function stageStyle(layout: StageLayout): string {
  const translate = `translate(${round(layout.offsetX)}px,${round(layout.offsetY)}px)`;
  const scale = `scale(${round(layout.scaleX)},${round(layout.scaleY)})`;
  return [
    `width:${layout.width}px`,
    `height:${layout.height}px`,
    `transform:${translate} ${scale}`,
  ].join(";");
}

/** 小数截到三位：避免布局浮点数把样式串撑得过长 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 拼行内样式：camelCase 键转 CSS 声明的连字符形态，值原样（数值已在元素样式层折算） */
function styleText(
  style: Readonly<Record<string, string>> | undefined,
): string {
  if (style === undefined) return "";
  return Object.entries(style)
    .map(([property, value]) => `${toCssProperty(property)}:${value}`)
    .join(";");
}

/** `maxWidth` → `max-width`（已是连字符形态的原样保留） */
function toCssProperty(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
