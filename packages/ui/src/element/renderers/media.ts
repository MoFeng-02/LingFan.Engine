/**
 * 图像族渲染器：`image` / `background` / `portrait` / `video` / `imagebutton`。
 *
 * 资源解析统一走 `ctx.resolveResource`：解析失败时**保留原文**（alt / 文本），
 * 不伪造占位图——静默占位会掩盖内容错误。
 *
 * 填充方式（`stretch`）落成两列 CSS：`<img>`/`<video>` 用 `object-fit`，
 * 背景元素用 `background-size` + `background-position`（`object-fit` 对 `div` 无效）。
 */
import {
  DEFAULT_ELEMENT_FIT,
  ELEMENT_FITS,
  type ElementFit,
} from "@lingfan-engine/core";
import { elementSource, fitBackgroundStyle, fitObjectStyle } from "../style";
import { bindInteraction, isDisabled } from "./bindings";
import { createRoot, withProps, withStyle } from "./base";
import type { ElementRenderContext } from "../registry";
import type { RenderSpec } from "../spec";

/** 元素声明的填充方式（未写或写坏都回退缺省词：属性值来自作者数据，不做抛错） */
function elementFit(props: Record<string, unknown>): ElementFit {
  const raw = props.stretch;
  return typeof raw === "string" &&
    (ELEMENT_FITS as readonly string[]).includes(raw)
    ? (raw as ElementFit)
    : DEFAULT_ELEMENT_FIT;
}

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

/**
 * 图像：图像壳 + 资源（解析不出时把路径落在 `alt` 上，让读者看得见缺了什么）。
 *
 * `image` / `background` / `portrait` 三个类型共用本渲染器（注册表里并列登记），
 * 所以填充方式必须在这里按 `ctx.element.type` 分支：背景元素的根节点就是那个
 * 铺图层的 `div`，填充落在 `background-size` 上；其余两类的根节点是 `<img>`，
 * 填充落在 `object-fit` 上。分错支的表现是「背景写着填充方式但画面不动」。
 */
export function renderImage(ctx: ElementRenderContext): RenderSpec {
  const fit = elementFit(ctx.element.props);
  const root = createRoot("image", ctx);
  if (ctx.element.type === "background") {
    const background = fitBackgroundStyle(fit);
    return bindInteraction(
      withStyle(applySource(root, ctx, "backgroundImage"), {
        backgroundSize: background.size,
        backgroundPosition: background.position,
      }),
      ctx,
    );
  }
  return bindInteraction(
    withStyle(applySource(root, ctx, "src"), {
      objectFit: fitObjectStyle(fit),
    }),
    ctx,
  );
}

/**
 * 视频：媒体壳（隐藏控件，播放由视频域驱动），资源接法与图像同一条路。
 * 占位节点上的 `objectFit` 与真实 `<video>` 由视频端口写的那份同源（同一词表），
 * 因此宿主不接管端口时画面与描述仍一致。
 */
export function renderVideo(ctx: ElementRenderContext): RenderSpec {
  const fit = fitObjectStyle(elementFit(ctx.element.props));
  const spec = withStyle(
    withProps(createRoot("media", ctx), { controls: false }),
    {
      objectFit: fit,
    },
  );
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
      style: { objectFit: fitObjectStyle(elementFit(ctx.element.props)) },
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
