/**
 * 渲染树翻译：把 `@lingfan-engine/ui` 的元素描述翻成小程序能绑定的数据树。
 *
 * 小程序没有 DOM，WXML 只能绑数据，所以渲染端口在这里不是「造节点」而是「算数据」：
 * 本文件把描述树算成 `MiniNode[]`，由页面把它送进 setData，再由 WXML 的递归模板
 * 铺开。样式串也在这里拼好（camelCase 键 → CSS 声明），免得模板里再算一遍。
 */
import type { StageLayout } from "@lingfan-engine/shell";
import type { RenderSpec } from "@lingfan-engine/ui";

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
  /** 图像节点的填充方式（平台 `<image>` 的 `mode` 值）；非图像节点没有这一项 */
  mode?: string;
  /** 子节点 */
  children?: MiniNode[];
}

/**
 * 填充方式 → 平台 `<image>` 的 `mode`。
 *
 * 小程序没有 `object-fit`，`<image>` 只有 `scaleToFill` / `aspectFit` / `aspectFill` /
 * `widthFix` / `heightFix` 五个词，语义也不完全对应。`none`（不缩放、居中、超出裁掉）用
 * `center` 恰好对上；`scale-down`（只缩不放）平台无法表达，退化为 `aspectFit`——小图会被
 * 放大，这是已知的语义缺口，不做补偿：按原始尺寸判该不该缩放要先异步取一次图片信息，
 * 代价远高于收益。
 *
 * 入参是描述树里已经算好的 `object-fit` 值（与元素层的填充词表同一套词）。未写与写坏
 * 走同一条路：都落到 `aspectFill`，与元素层缺省是 `cover` 保持一致。
 */
export function imageModeOf(fit: string | undefined): string {
  switch (fit) {
    case "fill":
      return "scaleToFill";
    case "contain":
      return "aspectFit";
    case "cover":
      return "aspectFill";
    case "none":
      return "center";
    case "scale-down":
      return "aspectFit";
    default:
      return "aspectFill";
  }
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
  if (spec.kind === "image") node.mode = imageModeOf(spec.style?.["objectFit"]);
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
