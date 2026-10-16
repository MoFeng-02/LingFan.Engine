/**
 * 交互与视觉态绑定（渲染器共用）。
 *
 * 三类视觉态（`disabled_*` / `hover_*` / `selected_*`）与点击行为**正交**：
 * 禁用元素不挂点击但仍保留可辨识视觉态，否则玩家只看到「点了没反应」。
 * 点击类判定走纯函数，与宿主选路同源，避免两处判定漂移。
 *
 * 视觉态交换以「事件补丁」表达（`RenderEvent.handler` 的返回值）：
 * 空闲值取自描述树自身，**不从节点读回**——渲染器手上没有节点。
 */
import { hasElementInteraction, isElementDisabled } from "../interaction";
import type { ElementRenderContext } from "../registry";
import type { RenderEventPatch, RenderSpec } from "../spec";
import { withEvents, withProps, withStyle } from "./base";

/**
 * 元素是否被禁用（最高优先级 `disabled`；`enabled=false` 同义）。
 * 表达式形态的 `disabled` 由宿主求值后经 `ctx.evalDisable` 注入——UI 层不解析表达式语法。
 */
export function isDisabled(ctx: ElementRenderContext): boolean {
  const props = ctx.element.props;
  return isElementDisabled(props, { evalDisable: ctx.evalDisable });
}

/** 非空字符串属性（`disabled_color` / `hover_color` / `selected_color` 共用判据） */
function colorProp(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 数值或长度串属性（`*_opacity` 共用判据） */
function opacityProp(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 换图资源（`*_source`）：解析不出即不做改动（不伪造） */
function sourceUrl(
  ctx: ElementRenderContext,
  value: unknown,
): string | undefined {
  const source = colorProp(value);
  return source === undefined ? undefined : ctx.resolveResource?.(source);
}

/**
 * `disabled_*` 视觉：禁用时改前景色 / 透明度 / 换图。
 * 与点击正交——禁用元素不挂点击，但仍有可辨识的视觉态。
 */
function applyDisabled(
  spec: RenderSpec,
  ctx: ElementRenderContext,
): RenderSpec {
  if (!isDisabled(ctx)) return spec;
  const props = ctx.element.props;
  const color = colorProp(props.disabled_color);
  const opacity = opacityProp(props.disabled_opacity);
  const url = sourceUrl(ctx, props.disabled_source);
  let out = spec;
  const style: Record<string, string> = {};
  if (color !== undefined) style.color = color;
  if (opacity !== undefined) style.opacity = opacity;
  if (Object.keys(style).length > 0) out = withStyle(out, style);
  // 换图只发生在图像壳上（与既有实现同判据：非图像壳忽略 `disabled_source`）
  if (url !== undefined && spec.kind === "image") {
    out = withProps(out, { src: url });
  }
  return out;
}

/**
 * `hover_*` 视觉：`hover_color` 改前景色、
 * `hover_opacity` 改透明度、`hover_source` 换图（仅 image）。与点击正交。
 */
function applyHover(spec: RenderSpec, ctx: ElementRenderContext): RenderSpec {
  const props = ctx.element.props;
  const color = colorProp(props.hover_color);
  const opacity = opacityProp(props.hover_opacity);
  const url = sourceUrl(ctx, props.hover_source);
  if (color === undefined && opacity === undefined && url === undefined) {
    return spec;
  }

  const isImage = spec.kind === "image";
  const idleColor = spec.style?.color;
  const idleOpacity = spec.style?.opacity;
  const idleSrc = isImage ? spec.props?.src : undefined;

  const enter: RenderEventPatch = {};
  const leave: RenderEventPatch = {};
  if (color !== undefined) {
    enter.style = { ...enter.style, color };
    leave.style = { ...leave.style, color: idleColor ?? "" };
  }
  if (opacity !== undefined) {
    enter.style = { ...enter.style, opacity };
    leave.style = { ...leave.style, opacity: idleOpacity ?? "" };
  }
  if (url !== undefined && isImage) {
    enter.props = { ...enter.props, src: url };
    leave.props = { ...leave.props, src: idleSrc ?? "" };
  }

  return withEvents(spec, [
    { on: "mouseenter", handler: () => enter },
    { on: "mouseleave", handler: () => leave },
  ]);
}

/**
 * `selected_*` 视觉：点击切换选中态
 * （`selected_color` 改前景色、`selected_source` 换图）。
 */
function applySelected(
  spec: RenderSpec,
  ctx: ElementRenderContext,
): RenderSpec {
  const props = ctx.element.props;
  const color = colorProp(props.selected_color);
  const url = sourceUrl(ctx, props.selected_source);
  if (color === undefined && url === undefined) return spec;

  const isImage = spec.kind === "image";
  const idleColor = spec.style?.color;
  const idleSrc = isImage ? spec.props?.src : undefined;
  let selected = false;
  return withEvents(spec, [
    {
      on: "click",
      handler: (): RenderEventPatch => {
        selected = !selected;
        const patch: RenderEventPatch = {};
        if (color !== undefined) {
          patch.style = { color: selected ? color : (idleColor ?? "") };
        }
        if (url !== undefined && isImage) {
          patch.props = { src: selected ? url : (idleSrc ?? "") };
        }
        return patch;
      },
    },
  ]);
}

/**
 * 交互绑定，完整优先级：`disabled` > `nav` > `ops` > `cmd` > `hover_*` > `selected_*`。
 * - 点击：`disabled` 短路（不挂任何交互，但保留禁用视觉态）→ `nav`（核心 `navigate`）→
 *   `ops`（引擎按序执行数据侧动作）→ `cmd`（宿主命名命令）；
 *   分支判定在宿主（`activate` 回调内按该优先级选路），本层只负责挂载与短路。
 * - 视觉：`hover_*` / `selected_*` / `disabled_*` 与点击正交，独立绑定。
 */
export function bindInteraction(
  spec: RenderSpec,
  ctx: ElementRenderContext,
): RenderSpec {
  let out = applyDisabled(spec, ctx); // 禁用视觉态（不挂点击）
  if (isDisabled(ctx)) return out; // 最高优先级：禁用即不挂任何交互
  out = applyHover(out, ctx);
  out = applySelected(out, ctx);

  // 点击类交互判定走纯函数（与宿主分支同源，避免两处判定漂移）
  if (
    !hasElementInteraction(ctx.element.props, { evalDisable: ctx.evalDisable })
  ) {
    return out;
  }
  // 元素层容器 pointer-events:none（不阻塞舞台推进）——可交互元素自行恢复
  out = withStyle(out, { cursor: "pointer", pointerEvents: "auto" });
  return withEvents(out, [
    {
      on: "click",
      // 元素点击不应同时触发舞台推进
      stopPropagation: true,
      handler: () => {
        ctx.activate?.(ctx.element);
      },
    },
  ]);
}
