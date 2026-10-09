/**
 * 容器族渲染器：`panel` 组（默认 flex 排布）、`grid`、`canvas`、`border`、
 * `scroll` 组（`scroll` / `scrollviewer` / `viewport`）。
 */
import { ELEMENT_CONTAINER_TYPES } from "@lingfan/engine";
import { bindInteraction } from "./bindings";
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";

/**
 * 契约判为「容器」（可承载子元素）之外的 6 型。
 *
 * 契约的容器判据管的是**结构合法性**：这 6 型确实能装子元素，
 * 但各自的排布语义由专用分支决定（网格轨道 / 绝对定位 / 边框 / 滚动溢流），
 * 不走默认 flex 分支。这里显式列出差值，是为了让契约新增容器类型时
 * 默认排布不会被悄悄改变——若哪天新增的类型本就该 flex 排布，
 * 从这份差集里去掉它即可，改动点只有一处。
 */
const NON_FLEX_CONTAINERS: ReadonlySet<string> = new Set([
  "grid",
  "canvas",
  "border",
  "scroll",
  "scrollviewer",
  "viewport",
]);

/** 默认走 flex 排布的容器类型（由契约容器集合减去专用分支型派生） */
const FLEX_CONTAINERS: ReadonlySet<string> = new Set(
  [...ELEMENT_CONTAINER_TYPES].filter((t) => !NON_FLEX_CONTAINERS.has(t)),
);

/** 容器盒模型：flex 方向（`direction` 覆盖类型默认）与 `spacing` → gap */
function applyContainerBox(el: HTMLElement, ctx: ElementRenderContext): void {
  const props = ctx.element.props;
  const type = ctx.element.type;
  if (!FLEX_CONTAINERS.has(type) && props.direction === undefined) return;
  el.style.display = "flex";
  const horizontal =
    props.direction === "horizontal" || props.direction === "row";
  el.style.flexDirection = horizontal || type === "hbox" ? "row" : "column";
  const spacing = props.spacing;
  if (typeof spacing === "number") el.style.gap = `${spacing}px`;
  else if (typeof spacing === "string" && spacing !== "") el.style.gap = spacing;
}

export function renderContainer(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  applyContainerBox(el, ctx);
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

/**
 * grid：`columns`/`rows` 支持数字（等分）或 CSS 轨道串；
 * 子元素附着 `col`/`row`/`colspan`/`rowspan` 按 Grid 语义（**0 基**）
 * 映射到 CSS Grid（1 基）。
 */
export function renderGrid(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  el.style.display = "grid";
  const toTrack = (value: unknown): string | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `repeat(${value}, 1fr)`;
    }
    if (typeof value === "string" && value !== "") return value;
    return undefined;
  };
  const columns = toTrack(ctx.element.props.columns);
  const rows = toTrack(ctx.element.props.rows);
  if (columns !== undefined) el.style.gridTemplateColumns = columns;
  if (rows !== undefined) el.style.gridTemplateRows = rows;

  ctx.renderChildren(el, ctx.element.children);
  // Grid 附着属性：渲染完成按序对齐子节点（渲染器不返回节点，故按 DOM 顺序索引；
  // style 用鸭子类型取，避免跨环境 instanceof 失效）
  ctx.element.children.forEach((child, index) => {
    const node = el.children[index] as unknown as HTMLElement | undefined;
    if (node === undefined) return;
    const { col, row, colspan, rowspan } = child.props;
    if (typeof col === "number") node.style.gridColumnStart = String(col + 1);
    if (typeof row === "number") node.style.gridRowStart = String(row + 1);
    if (typeof colspan === "number") node.style.gridColumnEnd = `span ${colspan}`;
    if (typeof rowspan === "number") node.style.gridRowEnd = `span ${rowspan}`;
  });
  bindInteraction(el, ctx);
  return el;
}

/** canvas：自由定位容器（子元素按自身 x/y 绝对定位） */
export function renderCanvas(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.position) el.style.position = "relative";
  if (!el.style.overflow) el.style.overflow = "hidden";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

/** border：纯边框/背景容器（外观由 `borderColor`/`borderThickness`/`cornerRadius` 驱动） */
export function renderBorder(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.border) el.style.border = "1px solid currentColor";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

/**
 * 滚动容器：`scroll_h`/`scroll_v` 为 false 时关闭对应轴滚动；
 * `viewport` 语义 = 裁剪视口（不外溢，特化渲染分支）。
 */
export function renderScroll(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  el.style.overflow = ctx.element.type === "viewport" ? "hidden" : "auto";
  if (ctx.element.props.scroll_h === false) el.style.overflowX = "hidden";
  if (ctx.element.props.scroll_v === false) el.style.overflowY = "hidden";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}
