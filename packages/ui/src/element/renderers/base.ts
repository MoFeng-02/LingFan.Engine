/**
 * 渲染器公共基座：根节点描述与数值属性读取。
 *
 * 根节点一次承载三样东西：基类（元素层通用样式）、类型类（按类型定向样式）、
 * 作者 class（`class` / `style` 属性别名），以及属性映射出的 CSS 声明。
 */
import { elementClassName, elementStyle } from "../style";
import type { ElementRenderContext } from "../registry";
import type { RenderEvent, RenderKind, RenderSpec } from "../spec";

/** 元素根节点基类名：所有渲染器共用，类型类与作者 class 另加 */
const BASE_CLASS = "lf-el";

/** 元素根节点描述：基类 + 类型类 + 作者 class（style 别名）+ 属性 → CSS */
export function createRoot(
  kind: RenderKind,
  ctx: ElementRenderContext,
): RenderSpec {
  const authorClass = elementClassName(ctx.element.props);
  return {
    kind,
    className: [BASE_CLASS, `lf-${ctx.element.type}`, authorClass]
      .filter((s) => s !== "")
      .join(" "),
    style: elementStyle(ctx.element.props),
  };
}

/** 追加/覆盖样式声明，返回新描述（渲染器不改手上的那棵） */
export function withStyle(
  spec: RenderSpec,
  style: Readonly<Record<string, string>>,
): RenderSpec {
  return { ...spec, style: { ...spec.style, ...style } };
}

/** 追加/覆盖原生属性，返回新描述（插入顺序即物化顺序，勿打乱 `crossOrigin` 与 `src`） */
export function withProps(
  spec: RenderSpec,
  props: Readonly<Record<string, string | number | boolean>>,
): RenderSpec {
  return { ...spec, props: { ...spec.props, ...props } };
}

/** 追加事件绑定，返回新描述（已有事件保序在前） */
export function withEvents(
  spec: RenderSpec,
  events: readonly RenderEvent[],
): RenderSpec {
  return { ...spec, events: [...(spec.events ?? []), ...events] };
}

/** 数值属性读取：非有限数值一律回退（`min` / `max` / `value` 等共用） */
export function numProp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
