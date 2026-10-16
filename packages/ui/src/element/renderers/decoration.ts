/**
 * 间隔装饰：`separator`（分隔线）与 `spacer`（自适应留白）。
 *
 * 两者都是「无子节点的盒子」，只改一行布局声明：分隔线取当前前景色画一根 1px 线，
 * 留白取 flex 剩余空间。作者已显式写下的同类声明优先（不覆盖）。
 */
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";
import { createRoot, withStyle } from "./base";

export function renderSeparator(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const style: Record<string, string> = { ...spec.style };
  if (style.background === undefined) style.background = "currentColor";
  if (ctx.element.props.direction === "vertical") {
    if (style.width === undefined) style.width = "1px";
    if (style.height === undefined) style.alignSelf = "stretch";
  } else if (style.height === undefined) {
    style.height = "1px";
  }
  return { ...spec, style };
}

export function renderSpacer(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  if (spec.style?.flex !== undefined) return spec;
  return withStyle(spec, { flex: "1 1 auto" });
}
