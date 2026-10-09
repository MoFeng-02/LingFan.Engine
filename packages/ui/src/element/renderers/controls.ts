/**
 * 控件族渲染器：`button` / `choice` / `slider` / `checkbox` / 进度条三型。
 * 取值统一经 `numProp` 归一，比例裁剪复用引擎侧的数值判据。
 */
import { clamp01 } from "@lingfan/engine";
import { bindInteraction, isDisabled } from "./bindings";
import { createRoot, numProp } from "./base";
import type { ElementRenderContext } from "../registry";

export function renderButton(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("button", ctx) as HTMLButtonElement;
  el.type = "button";
  const text = ctx.element.props.text;
  if (typeof text === "string") el.textContent = text;
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}

/** 进度条：`value` 在 `[min, max]` 内的比例 → 内层填充（vbar 纵向） */
export function renderProgress(ctx: ElementRenderContext): HTMLElement {
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

export function renderSlider(ctx: ElementRenderContext): HTMLElement {
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

export function renderCheckbox(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("input", ctx) as HTMLInputElement;
  el.type = "checkbox";
  if (ctx.element.props.checked === true) el.checked = true;
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}
