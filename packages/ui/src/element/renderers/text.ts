/**
 * 文本族渲染器：`text` / `dialog` / `narrator` / `speaker` 共用同一落地形态
 * （差异在属性与样式，不在 DOM 结构）。
 */
import { bindInteraction } from "./bindings";
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";

export function renderText(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  const text = ctx.element.props.text;
  if (typeof text === "string") el.textContent = text;
  bindInteraction(el, ctx);
  return el;
}
