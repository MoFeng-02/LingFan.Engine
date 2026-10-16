/**
 * 文本族渲染（text / dialog / narrator / speaker）。
 *
 * 四种类型共用同一渲染器：差异由属性（font/size/color/halign…）与 CSS 类名表达，
 * 结构上都是「一个承载纯文本的块元素」。文本内容**不做转义/净化**——
 * 文本族的富文本渲染由对话域负责；元素文本是纯文本，交给宿主原样落地。
 */
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";
import { bindInteraction } from "./bindings";
import { createRoot } from "./base";

export function renderText(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("text", ctx);
  const text = ctx.element.props.text;
  return bindInteraction(
    typeof text === "string" ? { ...spec, text } : spec,
    ctx,
  );
}
