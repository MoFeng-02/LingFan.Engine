/**
 * 08 §二.1 元素属性 → CSS 映射（纯函数，可测）。
 *
 * 只做「属性名/值 → 样式声明」的机械映射：属性合法性在解析期已 fail-closed（F5），
 * 此处不重复校验；**尚未实现语义的属性被忽略**（不报错，P2 按 36 类型补齐）。
 *
 * 定位语义对齐老引擎 `LayoutHelper`：`x`/`y` 支持百分比（老引擎换算为像素 Margin，
 * DOM 侧直接交给 CSS，`left: 50%` 天然按父容器尺寸解析）。
 */

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

/** 首个子属性值（老引擎多键别名：source/src/path、color/fontColor/textColor） */
function pick(
  props: Record<string, unknown>,
  ...keys: string[]
): unknown {
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

  // —— 定位（x/y/right/bottom 任一存在即绝对定位；对齐老引擎百分比定位语义）——
  const x = len(props.x);
  const y = len(props.y);
  const right = len(props.right);
  const bottom = len(props.bottom);
  if (x !== undefined || y !== undefined || right !== undefined || bottom !== undefined) {
    set("position", "absolute");
    if (x !== undefined) set("left", x);
    if (y !== undefined) set("top", y);
    if (right !== undefined) set("right", right);
    if (bottom !== undefined) set("bottom", bottom);
  }
  // 老引擎 align 是 halign 的安全网（DslParser.cs:306-308）：显式 textAlign/halign 优先
  set("textAlign", len(props.textAlign) ?? len(props.halign) ?? len(props.align));

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
    set("border", `${borderThickness ?? "1px"} solid ${borderColor ?? "currentColor"}`);
  }

  // —— 文本 ——
  // size = 文本类 fontSize 别名（DslParser.cs:310-317）
  set("fontSize", len(props.fontSize) ?? len(props.size));
  set("fontFamily", len(props.font));
  const color = pick(props, "color", "fontColor", "textColor");
  set("color", typeof color === "string" ? color : undefined);

  return out;
}

/** 内容/样式类属性（不进 CSS，由渲染器消费） */
export function elementClassName(props: Record<string, unknown>): string {
  // 老引擎 `style` 是 `class` 的别名（DslParser.cs:300-303）
  const raw = pick(props, "class", "style");
  return typeof raw === "string" ? raw : "";
}

/** 图片类元素的资源路径（source 优先，src/path 兜底） */
export function elementSource(props: Record<string, unknown>): string | undefined {
  const raw = pick(props, "source", "src", "path");
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}
