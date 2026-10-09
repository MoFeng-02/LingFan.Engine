/**
 * 交互与视觉态绑定（渲染器共用）。
 *
 * 三类视觉态（`disabled_*` / `hover_*` / `selected_*`）与点击行为**正交**：
 * 禁用元素不挂点击但仍保留可辨识视觉态，否则玩家只看到「点了没反应」。
 * 点击类判定走纯函数，与宿主选路同源，避免两处判定漂移。
 */
import { hasElementInteraction, isElementDisabled } from "../interaction";
import type { ElementRenderContext } from "../registry";

/**
 * 元素是否被禁用（最高优先级 `disabled`；`enabled=false` 同义）。
 * 表达式形态的 `disabled` 由宿主求值后经 `ctx.evalDisable` 注入——UI 层不解析表达式语法。
 */
export function isDisabled(ctx: ElementRenderContext): boolean {
  const props = ctx.element.props;
  return isElementDisabled(props, { evalDisable: ctx.evalDisable });
}

/**
 * `disabled_*` 视觉：禁用时改前景色 / 透明度 / 换图。
 * 与点击正交——禁用元素不挂点击，但仍有可辨识的视觉态。
 */
function bindDisabled(el: HTMLElement, ctx: ElementRenderContext): void {
  if (!isDisabled(ctx)) return;
  const props = ctx.element.props;
  const color =
    typeof props.disabled_color === "string" && props.disabled_color !== ""
      ? props.disabled_color
      : undefined;
  const rawOpacity = props.disabled_opacity;
  const opacity =
    typeof rawOpacity === "number"
      ? String(rawOpacity)
      : typeof rawOpacity === "string" && rawOpacity !== ""
        ? rawOpacity
        : undefined;
  const source =
    typeof props.disabled_source === "string" && props.disabled_source !== ""
      ? props.disabled_source
      : undefined;
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);
  if (color !== undefined) el.style.color = color;
  if (opacity !== undefined) el.style.opacity = opacity;
  if (url !== undefined && el.tagName === "IMG") {
    (el as HTMLImageElement).src = url;
  }
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
 * 交互绑定，完整优先级：`disabled` > `nav` > `ops` > `cmd` > `hover_*` > `selected_*`。
 * - 点击：`disabled` 短路（不挂任何交互，但保留禁用视觉态）→ `nav`（核心 `navigate`）→
 *   `ops`（引擎按序执行数据侧动作）→ `cmd`（宿主命名命令）；
 *   分支判定在宿主（`activate` 回调内按该优先级选路），本层只负责挂载与短路。
 * - 视觉：`hover_*` / `selected_*` / `disabled_*` 与点击正交，独立绑定。
 */
export function bindInteraction(el: HTMLElement, ctx: ElementRenderContext): void {
  bindDisabled(el, ctx); // 禁用视觉态（不挂点击）
  if (isDisabled(ctx)) return; // 最高优先级：禁用即不挂任何交互
  bindHover(el, ctx);
  bindSelected(el, ctx);

  // 点击类交互判定走纯函数（与宿主分支同源，避免两处判定漂移）
  if (
    !hasElementInteraction(ctx.element.props, { evalDisable: ctx.evalDisable })
  )
    return;
  el.style.cursor = "pointer";
  // 元素层容器 pointer-events:none（不阻塞舞台推进）——可交互元素自行恢复
  el.style.pointerEvents = "auto";
  el.addEventListener("click", (event) => {
    event.stopPropagation(); // 元素点击不应同时触发舞台推进
    ctx.activate?.(ctx.element);
  });
}
