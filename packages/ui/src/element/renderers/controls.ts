/**
 * 控件族渲染器：`button` / `choice` / `slider` / `checkbox` / 进度条三型。
 * 取值统一经 `numProp` 归一，比例裁剪复用引擎侧的数值判据。
 */
import { clamp01 } from "@lingfan-engine/core";
import { bindInteraction, isDisabled } from "./bindings";
import { createRoot, numProp, withProps, withStyle } from "./base";
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";

/** 按钮：取 `text` 作正文，禁用态落到原生 `disabled`，再挂交互绑定 */
export function renderButton(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("action", ctx);
  const text = ctx.element.props.text;
  const withText = typeof text === "string" ? { ...spec, text } : spec;
  const props: Record<string, string | boolean> = { type: "button" };
  if (isDisabled(ctx)) props.disabled = true;
  return bindInteraction(withProps(withText, props), ctx);
}

/** 进度条：`value` 在 `[min, max]` 内的比例 → 内层填充（vbar 纵向） */
export function renderProgress(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("box", ctx);
  const props = ctx.element.props;
  const min = numProp(props.min, 0);
  const max = numProp(props.max, 100);
  const value = numProp(props.value, min);
  const ratio = max > min ? clamp01((value - min) / (max - min)) : 0;
  const vertical = ctx.element.type === "vbar";

  const style: Record<string, string> = { ...spec.style };
  if (style.overflow === undefined) style.overflow = "hidden";

  const fillStyle: Record<string, string> = {
    position: "absolute",
    background: "currentColor",
  };
  if (vertical) {
    fillStyle.left = "0";
    fillStyle.right = "0";
    fillStyle.bottom = "0";
    fillStyle.height = `${ratio * 100}%`;
  } else {
    fillStyle.left = "0";
    fillStyle.top = "0";
    fillStyle.bottom = "0";
    fillStyle.width = `${ratio * 100}%`;
  }
  const fill: RenderSpec = {
    kind: "box",
    className: "lf-progress-fill",
    style: fillStyle,
  };
  return { ...spec, style, children: [fill] };
}

/** 滑块：`min`/`max`/`value` 归一后写进原生 input；纵向由 `orientation` 决定书写方向 */
export function renderSlider(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("slider", ctx);
  const withPropsSpec = withProps(spec, {
    type: "range",
    min: String(numProp(ctx.element.props.min, 0)),
    max: String(numProp(ctx.element.props.max, 100)),
    value: String(numProp(ctx.element.props.value, 0)),
  });
  const out =
    ctx.element.props.orientation === "vertical"
      ? withStyle(withPropsSpec, { writingMode: "vertical-lr" })
      : withPropsSpec;
  return bindInteraction(out, ctx);
}

/** 复选框：`checked === true` 才勾上（其余取值一律不勾，不猜真值） */
export function renderCheckbox(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("checkbox", ctx);
  const props: Record<string, string | boolean> = { type: "checkbox" };
  if (ctx.element.props.checked === true) props.checked = true;
  if (isDisabled(ctx)) props.disabled = true;
  return bindInteraction(withProps(spec, props), ctx);
}
