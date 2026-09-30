/**
 * 内建元素渲染器 —— **36 类型全覆盖**。
 * 分组按元素渲染语义落到 DOM/CSS：
 * 文本族 4 / 交互族 3 / 图像族 4 / 容器族 15 / 滚动族 3 / 进度族 5 / 间隔族 2。
 *
 * 职责边界：只产出 DOM 与样式；不读引擎状态、不发命令（交互经 `ctx.activate` 交回宿主）。
 * 未注册类型由 `renderElementTree` fail-closed 上报，不会静默渲染成空白。
 */
import {
  elementClassName,
  elementSource,
  elementStyle,
} from "./style";
import { hasElementInteraction } from "./interaction";
import type {
  ElementRegistry,
  ElementRenderContext,
  ElementRenderer,
} from "./registry";

const BASE_CLASS = "lf-el";

/** 以 flex 排布的容器类型（panel 组 + stack 组同一渲染分支） */
const FLEX_CONTAINERS: ReadonlySet<string> = new Set([
  "panel",
  "frame",
  "window",
  "dialogbox",
  "choicebox",
  "infobox",
  "overlay",
  "popup",
  "vbox",
  "hbox",
  "stack",
  "stackpanel",
]);

/** 元素根节点：基类 + 类型类 + 作者 class（style 别名）+ 属性 → CSS */
function createRoot(tag: string, ctx: ElementRenderContext): HTMLElement {
  const el = document.createElement(tag);
  const authorClass = elementClassName(ctx.element.props);
  el.className = [BASE_CLASS, `lf-${ctx.element.type}`, authorClass]
    .filter((s) => s !== "")
    .join(" ");
  Object.assign(el.style, elementStyle(ctx.element.props));
  return el;
}

/** 元素是否被禁用（最高优先级 `disabled`；`enabled=false` 同义） */
function isDisabled(ctx: ElementRenderContext): boolean {
  const props = ctx.element.props;
  return props.disabled === true || props.enabled === false;
}

/**
 * `hover_*` 视觉：`hover_color` 改前景色、
 * `hover_opacity` 改透明度、`hover_source` 换图（仅 img）。与点击正交。
 */
function bindHover(el: HTMLElement, ctx: ElementRenderContext): void {
  const props = ctx.element.props;
  const color =
    typeof props.hover_color === "string" && props.hover_color !== ""
      ? props.hover_color
      : undefined;
  const rawOpacity = props.hover_opacity;
  const opacity =
    typeof rawOpacity === "number"
      ? String(rawOpacity)
      : typeof rawOpacity === "string" && rawOpacity !== ""
        ? rawOpacity
        : undefined;
  const source =
    typeof props.hover_source === "string" && props.hover_source !== ""
      ? props.hover_source
      : undefined;
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);
  const isImg = el.tagName === "IMG";
  if (color === undefined && opacity === undefined && url === undefined) return;

  const idleColor = el.style.color;
  const idleOpacity = el.style.opacity;
  const idleSrc = isImg ? (el as HTMLImageElement).src : "";
  el.addEventListener("mouseenter", () => {
    if (color !== undefined) el.style.color = color;
    if (opacity !== undefined) el.style.opacity = opacity;
    if (url !== undefined && isImg) (el as HTMLImageElement).src = url;
  });
  el.addEventListener("mouseleave", () => {
    if (color !== undefined) el.style.color = idleColor;
    if (opacity !== undefined) el.style.opacity = idleOpacity;
    if (url !== undefined && isImg) (el as HTMLImageElement).src = idleSrc;
  });
}

/**
 * `selected_*` 视觉：点击切换选中态
 * （`selected_color` 改前景色、`selected_source` 换图）。
 */
function bindSelected(el: HTMLElement, ctx: ElementRenderContext): void {
  const props = ctx.element.props;
  const color =
    typeof props.selected_color === "string" && props.selected_color !== ""
      ? props.selected_color
      : undefined;
  const source =
    typeof props.selected_source === "string" && props.selected_source !== ""
      ? props.selected_source
      : undefined;
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);
  if (color === undefined && url === undefined) return;

  const isImg = el.tagName === "IMG";
  const idleColor = el.style.color;
  const idleSrc = isImg ? (el as HTMLImageElement).src : "";
  let selected = false;
  el.addEventListener("click", () => {
    selected = !selected;
    if (color !== undefined) el.style.color = selected ? color : idleColor;
    if (url !== undefined && isImg) {
      (el as HTMLImageElement).src = selected ? url : idleSrc;
    }
  });
}

/**
 * 交互绑定，完整优先级：`disabled` > `nav` > `cmd` > `hover_*` > `selected_*`。
 * - 点击：`disabled` 短路（不挂任何交互）→ `nav`（核心 `navigate`）→ `cmd`（宿主命名命令）；
 *   两者的分支判定在宿主（`activate` 回调内按该优先级选路），本层只负责挂载与短路。
 * - 视觉：`hover_*` / `selected_*` 与点击正交，独立绑定。
 */
function bindInteraction(el: HTMLElement, ctx: ElementRenderContext): void {
  if (isDisabled(ctx)) return; // 最高优先级：禁用即不挂任何交互
  bindHover(el, ctx);
  bindSelected(el, ctx);

  // 点击类交互判定走纯函数（与宿主分支同源，避免两处判定漂移）
  if (!hasElementInteraction(ctx.element.props)) return;
  el.style.cursor = "pointer";
  // 元素层容器 pointer-events:none（不阻塞舞台推进）——可交互元素自行恢复
  el.style.pointerEvents = "auto";
  el.addEventListener("click", (event) => {
    event.stopPropagation(); // 元素点击不应同时触发舞台推进
    ctx.activate?.(ctx.element);
  });
}

function numProp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 容器盒模型：flex 方向（`direction` 覆盖类型默认）与 `spacing` → gap */
function applyContainerBox(el: HTMLElement, ctx: ElementRenderContext): void {
  const props = ctx.element.props;
  const type = ctx.element.type;
  if (!FLEX_CONTAINERS.has(type) && props.direction === undefined) return;
  el.style.display = "flex";
  const horizontal =
    props.direction === "horizontal" || props.direction === "row";
  el.style.flexDirection =
    horizontal || type === "hbox" ? "row" : "column";
  const spacing = props.spacing;
  if (typeof spacing === "number") el.style.gap = `${spacing}px`;
  else if (typeof spacing === "string" && spacing !== "") el.style.gap = spacing;
}

/** 解析资源并写回，失败/能力缺失时保留原文（不伪造占位） */
function applySource(
  el: HTMLElement,
  ctx: ElementRenderContext,
  attr: "src" | "backgroundImage",
): void {
  const source = elementSource(ctx.element.props);
  if (source === undefined) return;
  const url = ctx.resolveResource?.(source);
  if (url === undefined) {
    if (attr === "src") (el as HTMLImageElement).alt = source;
    return;
  }
  if (attr === "src") (el as HTMLImageElement).src = url;
  else el.style.backgroundImage = `url("${url}")`;
}

// ==================== 文本族（text / dialog / narrator / speaker）====================

function renderText(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  const text = ctx.element.props.text;
  if (typeof text === "string") el.textContent = text;
  bindInteraction(el, ctx);
  return el;
}

// ==================== 图像族（image / background / portrait / video）====================

function renderImage(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("img", ctx);
  applySource(el, ctx, "src");
  bindInteraction(el, ctx);
  return el;
}

function renderVideo(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("video", ctx) as HTMLVideoElement;
  el.controls = false;
  applySource(el, ctx, "src");
  bindInteraction(el, ctx);
  return el;
}

// ==================== 交互族（button / choice / imagebutton）====================

function renderButton(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("button", ctx) as HTMLButtonElement;
  el.type = "button";
  const text = ctx.element.props.text;
  if (typeof text === "string") el.textContent = text;
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}

/** imagebutton：按钮壳 + 图（`source` 优先，无则退化为文本） */
function renderImageButton(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("button", ctx) as HTMLButtonElement;
  el.type = "button";
  const source = elementSource(ctx.element.props);
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);
  if (url !== undefined) {
    const img = document.createElement("img");
    img.className = "lf-imagebutton-img";
    img.src = url;
    el.appendChild(img);
  } else {
    const text = ctx.element.props.text;
    el.textContent =
      typeof text === "string" ? text : (source ?? "");
  }
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}

// ==================== 容器族（15 类）====================

function renderContainer(ctx: ElementRenderContext): HTMLElement {
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
function renderGrid(ctx: ElementRenderContext): HTMLElement {
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
function renderCanvas(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.position) el.style.position = "relative";
  if (!el.style.overflow) el.style.overflow = "hidden";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

/** border：纯边框/背景容器（外观由 `borderColor`/`borderThickness`/`cornerRadius` 驱动） */
function renderBorder(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.border) el.style.border = "1px solid currentColor";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

// ==================== 滚动族（scroll / scrollviewer / viewport）====================

/**
 * 滚动容器：`scroll_h`/`scroll_v` 为 false 时关闭对应轴滚动；
 * `viewport` 语义 = 裁剪视口（不外溢，特化渲染分支）。
 */
function renderScroll(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  el.style.overflow = ctx.element.type === "viewport" ? "hidden" : "auto";
  if (ctx.element.props.scroll_h === false) el.style.overflowX = "hidden";
  if (ctx.element.props.scroll_v === false) el.style.overflowY = "hidden";
  ctx.renderChildren(el, ctx.element.children);
  bindInteraction(el, ctx);
  return el;
}

// ==================== 进度族（bar / vbar / progressbar / slider / checkbox）====================

/** 进度条：`value` 在 `[min, max]` 内的比例 → 内层填充（vbar 纵向） */
function renderProgress(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  const props = ctx.element.props;
  const min = numProp(props.min, 0);
  const max = numProp(props.max, 100);
  const value = numProp(props.value, min);
  const ratio = max > min ? clamp01((value - min) / (max - min)) : 0;
  const vertical = ctx.element.type === "vbar";

  if (!el.style.overflow) el.style.overflow = "hidden";
  const fill = document.createElement("div");
  fill.className = "lf-progress-fill";
  fill.style.position = "absolute";
  fill.style.background = "currentColor";
  if (vertical) {
    fill.style.left = "0";
    fill.style.right = "0";
    fill.style.bottom = "0";
    fill.style.height = `${ratio * 100}%`;
  } else {
    fill.style.left = "0";
    fill.style.top = "0";
    fill.style.bottom = "0";
    fill.style.width = `${ratio * 100}%`;
  }
  el.appendChild(fill);
  return el;
}

function renderSlider(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("input", ctx) as HTMLInputElement;
  el.type = "range";
  el.min = String(numProp(ctx.element.props.min, 0));
  el.max = String(numProp(ctx.element.props.max, 100));
  el.value = String(numProp(ctx.element.props.value, 0));
  if (ctx.element.props.orientation === "vertical") {
    el.style.writingMode = "vertical-lr";
  }
  bindInteraction(el, ctx);
  return el;
}

function renderCheckbox(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("input", ctx) as HTMLInputElement;
  el.type = "checkbox";
  if (ctx.element.props.checked === true) el.checked = true;
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}

// ==================== 间隔族（separator / spacer）====================

/** separator：细线（`direction=vertical` → 竖线） */
function renderSeparator(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  const vertical = ctx.element.props.direction === "vertical";
  if (!el.style.background) el.style.background = "currentColor";
  if (vertical) {
    if (!el.style.width) el.style.width = "1px";
    if (!el.style.height) el.style.alignSelf = "stretch";
  } else if (!el.style.height) {
    el.style.height = "1px";
  }
  return el;
}

/** spacer：弹性留白（flex 容器内占比） */
function renderSpacer(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.flex) el.style.flex = "1 1 auto";
  return el;
}

// ==================== 注册（36 类型全覆盖）====================

/** 内建渲染器注册（宿主可在其后覆盖任意类型；未注册类型由宿主 fail-closed 上报） */
export function registerBuiltinElementRenderers(registry: ElementRegistry): void {
  const reg: Record<string, ElementRenderer> = {
    // 文本族 4
    text: renderText,
    dialog: renderText,
    narrator: renderText,
    speaker: renderText,
    // 交互族 3
    button: renderButton,
    choice: renderButton,
    imagebutton: renderImageButton,
    // 图像族 4
    image: renderImage,
    background: renderImage,
    portrait: renderImage,
    video: renderVideo,
    // 容器族 15
    panel: renderContainer,
    frame: renderContainer,
    window: renderContainer,
    dialogbox: renderContainer,
    choicebox: renderContainer,
    infobox: renderContainer,
    overlay: renderContainer,
    popup: renderContainer,
    vbox: renderContainer,
    hbox: renderContainer,
    grid: renderGrid,
    stack: renderContainer,
    stackpanel: renderContainer,
    canvas: renderCanvas,
    border: renderBorder,
    // 滚动族 3
    scroll: renderScroll,
    scrollviewer: renderScroll,
    viewport: renderScroll,
    // 进度族 5
    bar: renderProgress,
    vbar: renderProgress,
    progressbar: renderProgress,
    slider: renderSlider,
    checkbox: renderCheckbox,
    // 间隔族 2
    separator: renderSeparator,
    spacer: renderSpacer,
  };
  for (const [type, renderer] of Object.entries(reg)) {
    registry.register(type, renderer);
  }
}
