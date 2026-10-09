/**
 * 渲染器公共基座：根节点构造与数值属性读取。
 *
 * 根节点一次承载三样东西：基类（元素层通用样式）、类型类（按类型定向样式）、
 * 作者 class（`class` / `style` 属性别名），以及属性映射出的 CSS 声明。
 */
import { elementClassName, elementStyle } from "../style";
import type { ElementRenderContext } from "../registry";

const BASE_CLASS = "lf-el";

/** 元素根节点：基类 + 类型类 + 作者 class（style 别名）+ 属性 → CSS */
export function createRoot(tag: string, ctx: ElementRenderContext): HTMLElement {
  const el = document.createElement(tag);
  const authorClass = elementClassName(ctx.element.props);
  el.className = [BASE_CLASS, `lf-${ctx.element.type}`, authorClass]
    .filter((s) => s !== "")
    .join(" ");
  Object.assign(el.style, elementStyle(ctx.element.props));
  return el;
}

/** 数值属性读取：非有限数值一律回退（`min` / `max` / `value` 等共用） */
export function numProp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
