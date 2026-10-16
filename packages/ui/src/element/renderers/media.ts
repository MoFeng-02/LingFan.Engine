/**
 * 图像族渲染器：`image` / `background` / `portrait` / `video` / `imagebutton`。
 *
 * 资源解析统一走 `ctx.resolveResource`：解析失败时**保留原文**（alt / 文本），
 * 不伪造占位图——静默占位会掩盖内容错误。
 */
import { elementSource } from "../style";
import { bindInteraction, isDisabled } from "./bindings";
import { createRoot, withProps, withStyle } from "./base";
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";

/** 解析资源并写回描述树，失败/能力缺失时保留原文（不伪造占位） */
export function applySource(
  spec: RenderSpec,
  ctx: ElementRenderContext,
  attr: "src" | "backgroundImage",
): RenderSpec {
  const source = elementSource(ctx.element.props);
  if (source === undefined) return spec;
  const url = ctx.resolveResource?.(source);
  if (url === undefined) {
    if (attr === "src") return withProps(spec, { alt: source });
    return spec;
  }
  if (attr === "src") {
    // CORS 匿名加载：存档缩略图 canvas 合成需可导出（lfstream 协议已带 ACAO:*；
    // blob/同源不受影响）。**须在 src 赋值前设置**——插入顺序即物化顺序。
    return withProps(spec, { crossOrigin: "anonymous", src: url });
  }
  return withStyle(spec, { backgroundImage: `url("${url}")` });
}

/** 图像：图像壳 + 资源（解析不出时把路径落在 `alt` 上，让读者看得见缺了什么） */
export function renderImage(ctx: ElementRenderContext): RenderSpec {
  return bindInteraction(
    applySource(createRoot("image", ctx), ctx, "src"),
    ctx,
  );
}

/** 视频：媒体壳（隐藏控件，播放由视频域驱动），资源接法与图像同一条路 */
export function renderVideo(ctx: ElementRenderContext): RenderSpec {
  const spec = withProps(createRoot("media", ctx), { controls: false });
  return bindInteraction(applySource(spec, ctx, "src"), ctx);
}

/** imagebutton：按钮壳 + 图（`source` 优先，无则退化为文本） */
export function renderImageButton(ctx: ElementRenderContext): RenderSpec {
  const spec = createRoot("action", ctx);
  const source = elementSource(ctx.element.props);
  const url = source === undefined ? undefined : ctx.resolveResource?.(source);

  let out: RenderSpec;
  if (url !== undefined) {
    const image: RenderSpec = {
      kind: "image",
      className: "lf-imagebutton-img",
      // 缩略图 canvas 合成：CORS 匿名加载（须先于 src）
      props: { crossOrigin: "anonymous", src: url },
    };
    out = { ...spec, children: [image] };
  } else {
    const text = ctx.element.props.text;
    out = { ...spec, text: typeof text === "string" ? text : (source ?? "") };
  }

  const props: Record<string, string | boolean> = { type: "button" };
  if (isDisabled(ctx)) props.disabled = true;
  return bindInteraction(withProps(out, props), ctx);
}
