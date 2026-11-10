/**
 * 元素属性 → CSS 映射（纯函数，可测）。
 * 只做「属性名/值 → 样式声明」的机械映射：属性合法性在解析期已 fail-closed，
 * 此处不重复校验；**未覆盖的属性一律不出现在结果中**。
 *
 * 「未覆盖」分两类：
 * ① **由渲染器消费**而非 CSS 的属性（`text` / `source` / `orientation` / `checked` / `nav` / `cmd` / Grid 轨道…）——正常分工；
 * ② **已声明但当前无 CSS 语义的属性**（`valign` / `xalign` / `yalign` / `xoffset` / `yoffset` / `xanchor` / `yanchor`）——
 *    对本映射写了不生效；清单单一事实源 = `@lingfan-engine/editor` 的 `UNIMPLEMENTED_ELEMENT_ATTRS`
 *    （编辑器不再下发这些控件，并对已存在的写出 warning；三面对齐互锁测试守住差集）。
 *    例外：`order` 不是死属性——引擎装载期在用（z 兜底：packages/core/src/data/element.ts:157、
 *    runtime/internal/frame-stack.ts:62 消费），只是不经本 CSS 映射，故不在本清单。
 *
 * 定位语义：`x`/`y` 支持百分比（若换算为像素 Margin 就锁死了尺寸，
 * DOM 侧直接交给 CSS，`left: 50%` 天然按父容器尺寸解析）。
 */

import {
  DEFAULT_ELEMENT_FIT,
  ELEMENT_FITS,
  type ElementFit,
} from "@lingfan-engine/core";

/** 数值 → css 长度（px）；字符串原样（支持 `50%` / `2em` / `center` 等） */
function len(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value !== "") return value;
  return undefined;
}

/** 数值原样（opacity / zIndex / scale 等纯数字） */
function num(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : undefined;
}

/** 布尔 → 显隐（`visible=false` 等价 `display:none`） */
function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** 首个子属性值（多键别名：source/src/path、color/fontColor/textColor） */
function pick(props: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = props[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 属性 → CSS 声明表。返回对象可直接 `Object.assign(el.style, table)`。
 * 未实现/不适用的属性不出现在结果中。
 */
export function elementStyle(
  props: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string | undefined): void => {
    if (value !== undefined) out[key] = value;
  };

  // —— 定位（x/y/right/bottom 任一存在即绝对定位；百分比值原样交给 CSS）——
  const x = len(props.x);
  const y = len(props.y);
  const right = len(props.right);
  const bottom = len(props.bottom);
  if (
    x !== undefined ||
    y !== undefined ||
    right !== undefined ||
    bottom !== undefined
  ) {
    set("position", "absolute");
    if (x !== undefined) set("left", x);
    if (y !== undefined) set("top", y);
    if (right !== undefined) set("right", right);
    if (bottom !== undefined) set("bottom", bottom);
  }
  // align 是 halign 的安全网：显式 textAlign/halign 优先
  set(
    "textAlign",
    len(props.textAlign) ?? len(props.halign) ?? len(props.align),
  );

  // —— 尺寸 ——
  set("width", len(props.width));
  set("height", len(props.height));
  set("minWidth", len(props.minWidth));
  set("minHeight", len(props.minHeight));
  set("maxWidth", len(props.maxWidth));
  set("maxHeight", len(props.maxHeight));

  // —— 盒模型 ——
  set("margin", len(props.margin));
  set("padding", len(props.padding));

  // —— 外观 ——
  set("opacity", num(props.opacity));
  set("zIndex", num(props.zindex));
  set("cursor", len(props.cursor));
  const visible = bool(props.visible);
  if (visible === false) set("display", "none");
  if (bool(props.clipToBounds) === true) set("overflow", "hidden");

  // —— 变换 ——
  const transforms: string[] = [];
  const rotation = num(props.rotation);
  if (rotation !== undefined) transforms.push(`rotate(${rotation}deg)`);
  const scale = num(props.scale);
  if (scale !== undefined) transforms.push(`scale(${scale})`);
  else {
    const scaleX = num(props.scaleX);
    const scaleY = num(props.scaleY);
    if (scaleX !== undefined || scaleY !== undefined) {
      transforms.push(`scale(${scaleX ?? "1"}, ${scaleY ?? "1"})`);
    }
  }
  if (transforms.length > 0) set("transform", transforms.join(" "));

  // —— 边框 ——
  set("borderRadius", len(props.cornerRadius));
  const borderThickness = len(props.borderThickness);
  const borderColor = len(props.borderColor) ?? len(props.borderBrush);
  if (borderThickness !== undefined || borderColor !== undefined) {
    set(
      "border",
      `${borderThickness ?? "1px"} solid ${borderColor ?? "currentColor"}`,
    );
  }

  // —— 文本 ——
  // size = 文本类 fontSize 别名
  set("fontSize", len(props.fontSize) ?? len(props.size));
  set("fontFamily", len(props.font));
  const color = pick(props, "color", "fontColor", "textColor");
  set("color", typeof color === "string" ? color : undefined);

  return out;
}

/** 内容/样式类属性（不进 CSS，由渲染器消费） */
export function elementClassName(props: Record<string, unknown>): string {
  // `style` 是 `class` 的别名
  const raw = pick(props, "class", "style");
  return typeof raw === "string" ? raw : "";
}

/**
 * 媒体填充的属性 → CSS 声明（img 侧与背景侧两列）。
 *
 * 两条独立函数而不是一条判别联合：调用点各自知道自己要哪一列（`<img>`/`<video>`
 * 用 `object-fit`，`div` 的背景图用 `background-size` + `background-position`），
 * 联合返回类型只会把判别工作推给每个调用方。
 *
 * 都不进 `elementStyle`：`object-fit` 对元素根节点（`div`）无效，
 * 写进去只会是一句看着生效、实际被忽略的声明。
 */
export function fitObjectStyle(fit: ElementFit): string {
  return objectFitOf(fit);
}

/**
 * 背景侧的填充 → `background-size` / `background-position`。
 *
 * 平台事实：CSS 的 `background-size` 没有 `scale-down`（那是 `object-fit` 独有）。
 * 所以 `scale-down` 在这里退化为 `auto`（原始尺寸）——小图不放大仍成立，
 * 大图不再缩到装得下，这是 CSS 背景能表达的最接近语义，不是取舍留白。
 */
export function fitBackgroundStyle(fit: ElementFit): {
  size: string;
  position: string;
} {
  return { size: backgroundSizeOf(fit), position: "center" };
}

/** 词表 → `object-fit` 值（未知值按缺省词处理，不抛：属性来自作者数据） */
function objectFitOf(fit: ElementFit): string {
  switch (normalizeFit(fit)) {
    case "contain":
      return "contain";
    case "fill":
      return "fill";
    case "none":
      return "none";
    case "scale-down":
      return "scale-down";
    default:
      return "cover";
  }
}

/** 词表 → `background-size` 值（`scale-down` 无对应词，退化为 `auto`） */
function backgroundSizeOf(fit: ElementFit): string {
  switch (normalizeFit(fit)) {
    case "contain":
      return "contain";
    case "fill":
      return "100% 100%";
    case "none":
    case "scale-down":
      return "auto";
    default:
      return "cover";
  }
}

/** 未知/缺失的填充方式回退缺省词（历史工程的自由字符串走这条路） */
function normalizeFit(fit: ElementFit | undefined): ElementFit {
  return fit !== undefined && ELEMENT_FITS.includes(fit)
    ? fit
    : DEFAULT_ELEMENT_FIT;
}

/** 图片类元素的资源路径（source 优先，src/path 兜底） */
export function elementSource(
  props: Record<string, unknown>,
): string | undefined {
  const raw = pick(props, "source", "src", "path");
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}
