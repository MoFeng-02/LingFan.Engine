/**
 * 间隔族渲染器：纯装饰元素，只出尺寸/颜色，**不挂交互**。
 */
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";

/** separator：细线（`direction=vertical` → 竖线） */
export function renderSeparator(ctx: ElementRenderContext): HTMLElement {
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
export function renderSpacer(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  if (!el.style.flex) el.style.flex = "1 1 auto";
  return el;
}
