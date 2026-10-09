/**
 * 图像族渲染器：`image` / `background` / `portrait` / `video` / `imagebutton`。
 *
 * 资源解析统一走 `ctx.resolveResource`：解析失败时**保留原文**（alt / 文本），
 * 不伪造占位图——静默占位会掩盖内容错误。
 */
import { elementSource } from "../style";
import { bindInteraction, isDisabled } from "./bindings";
import { createRoot } from "./base";
import type { ElementRenderContext } from "../registry";

/** 解析资源并写回，失败/能力缺失时保留原文（不伪造占位） */
export function applySource(
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
  if (attr === "src") {
    const media = el as HTMLImageElement | HTMLVideoElement;
    // CORS 匿名加载：存档缩略图 canvas 合成需可导出（lfstream 协议已带 ACAO:*；
    // blob/同源不受影响）。须在 src 赋值前设置。
    media.crossOrigin = "anonymous";
    media.src = url;
    return;
  }
  el.style.backgroundImage = `url("${url}")`;
}

/** 图像：`img` 壳 + 资源（解析不出时把路径落在 `alt` 上，让读者看得见缺了什么） */
export function renderImage(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("img", ctx);
  applySource(el, ctx, "src");
  bindInteraction(el, ctx);
  return el;
}

/** 视频：原生 `video` 壳（隐藏控件，播放由视频域驱动），资源接法与图像同一条路 */
export function renderVideo(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("video", ctx) as HTMLVideoElement;
  el.controls = false;
  applySource(el, ctx, "src");
  bindInteraction(el, ctx);
  return el;
}

/** imagebutton：按钮壳 + 图（`source` 优先，无则退化为文本） */
export function renderImageButton(ctx: ElementRenderContext): HTMLElement {
  const el = createRoot("button", ctx) as HTMLButtonElement;
  el.type = "button";
  const source = elementSource(ctx.element.props);
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);
  if (url !== undefined) {
    const img = document.createElement("img");
    img.className = "lf-imagebutton-img";
    img.crossOrigin = "anonymous"; // 缩略图 canvas 合成：CORS 匿名加载（须先于 src）
    img.src = url;
    el.appendChild(img);
  } else {
    const text = ctx.element.props.text;
    el.textContent = typeof text === "string" ? text : (source ?? "");
  }
  if (isDisabled(ctx)) el.disabled = true;
  bindInteraction(el, ctx);
  return el;
}
