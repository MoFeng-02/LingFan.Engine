/**
 * 容器族渲染器：`panel` 组（默认 flex 排布）、`grid`、`canvas`、`border`、
 * `scroll` 组（`scroll` / `scrollviewer` / `viewport`）。
 *
 * 子元素一律经 `ctx.renderChildren` 取描述树，再放进自己节点的 `children` 里——
 * 容器渲染器不接触任何节点对象。
 */
import { ELEMENT_CONTAINER_TYPES } from "@lingfan-engine/core";
import { bindInteraction } from "./bindings";
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";

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
function applyContainerBox(
  style: Record<string, string>,
  ctx: ElementRenderContext,
): void {
  const props = ctx.element.props;
  const type = ctx.element.type;
  if (!FLEX_CONTAINERS.has(type) && props.direction === undefined) return;
  style.display = "flex";
  const horizontal =
    props.direction === "horizontal" || props.direction === "row";
  style.flexDirection = horizontal || type === "hbox" ? "row" : "column";
  const spacing = props.spacing;
  if (typeof spacing === "number") style.gap = `${spacing}px`;
  else if (typeof spacing === "string" && spacing !== "") style.gap = spacing;
}

/** 面板族容器：默认 flex 盒 + 递归渲染子元素 + 交互绑定（`panel`/`frame`/`window`/`vbox` 等共用） */
export function renderContainer(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = { ...spec.style };
  applyContainerBox(style, ctx);
  return bindInteraction(
    { ...spec, style, children: ctx.renderChildren(ctx.element.children) },
    ctx,
  );
}

/**
 * grid：`columns`/`rows` 支持数字（等分）或 CSS 轨道串；
 * 子元素附着 `col`/`row`/`colspan`/`rowspan` 按 Grid 语义（**0 基**）
 * 映射到 CSS Grid（1 基）。
 */
export function renderGrid(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = { ...spec.style, display: "grid" };
  const toTrack = (value: unknown): string | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `repeat(${value}, 1fr)`;
    }
    if (typeof value === "string" && value !== "") return value;
    return undefined;
  };
  const columns = toTrack(ctx.element.props.columns);
  const rows = toTrack(ctx.element.props.rows);
  if (columns !== undefined) style.gridTemplateColumns = columns;
  if (rows !== undefined) style.gridTemplateRows = rows;

  const children = ctx.renderChildren(ctx.element.children);
  // Grid 附着属性：按「子元素序 ↔ 描述树序」对齐（未注册类型不产出描述树，
  // 与既有的 DOM 子节点索引同语义）
  ctx.element.children.forEach((child, index) => {
    const target = children[index];
    if (target === undefined) return;
    const { col, row, colspan, rowspan } = child.props;
    const next: Record<string, string> = { ...target.style };
    if (typeof col === "number") next.gridColumnStart = String(col + 1);
    if (typeof row === "number") next.gridRowStart = String(row + 1);
    if (typeof colspan === "number") next.gridColumnEnd = `span ${colspan}`;
    if (typeof rowspan === "number") next.gridRowEnd = `span ${rowspan}`;
    children[index] = { ...target, style: next };
  });
  return bindInteraction({ ...spec, style, children }, ctx);
}

/** canvas：自由定位容器（子元素按自身 x/y 绝对定位） */
export function renderCanvas(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = { ...spec.style };
  if (style.position === undefined) style.position = "relative";
  if (style.overflow === undefined) style.overflow = "hidden";
  return bindInteraction(
    { ...spec, style, children: ctx.renderChildren(ctx.element.children) },
    ctx,
  );
}

/** border：纯边框/背景容器（外观由 `borderColor`/`borderThickness`/`cornerRadius` 驱动） */
export function renderBorder(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = { ...spec.style };
  if (style.border === undefined) style.border = "1px solid currentColor";
  return bindInteraction(
    { ...spec, style, children: ctx.renderChildren(ctx.element.children) },
    ctx,
  );
}

/**
 * 滚动容器：`scroll_h`/`scroll_v` 为 false 时关闭对应轴滚动；
 * `viewport` 语义 = 裁剪视口（不外溢，特化渲染分支）。
 */
export function renderScroll(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = {
    ...spec.style,
    overflow: ctx.element.type === "viewport" ? "hidden" : "auto",
  };
  if (ctx.element.props.scroll_h === false) style.overflowX = "hidden";
  if (ctx.element.props.scroll_v === false) style.overflowY = "hidden";
  return bindInteraction(
    { ...spec, style, children: ctx.renderChildren(ctx.element.children) },
    ctx,
  );
}
