/**
 * 文本族渲染器：`text` / `dialog` / `narrator` / `speaker` 共用同一落地形态
 * （差异在属性与样式，不在 DOM 结构）。
 */
import { bindInteraction } from "./bindings";
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";

/**
 * 文本：取 `text` 作纯文本内容（不解析标记——富文本归对话渲染接缝），再挂交互绑定。
 * 四种文本类型的差异只体现在属性与皮肤上，DOM 形态因此共用这一个函数。
 */
export function renderText(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("div", ctx);
  const text = ctx.element.props.text;
  if (typeof text === "string") el.textContent = text;
  bindInteraction(el, ctx);
  return el;
}
