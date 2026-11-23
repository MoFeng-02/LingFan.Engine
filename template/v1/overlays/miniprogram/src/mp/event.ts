/**
 * 小程序组件事件载荷的读取口。
 *
 * uni-app 的 `@change` 给的是 `{ detail: { value } }`，但 `<switch>` 在 Vue 的类型
 * 解析里与 SVG 的 `<switch>` 同名，被当成 SVG 元素，`@change` 的载荷按 DOM `Event`
 * 推断。参数逆变方向不允许 `(event: { detail }) => void` 直接绑上去，故统一从
 * `Event` 收口，在这里窄化出小程序真正给的形状。
 *
 * 只读不改：拿不到就返回缺省值，不抛错——事件形状是平台契约，宿主不该因它崩。
 */

/** 取 `event.detail`，非对象或缺失时给空对象 */
function detailOf(event: Event): Record<string, unknown> {
  const raw = (event as Event & { readonly detail?: unknown }).detail;
  return raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
}

/** 取 `detail.value` 并断言成数字；非有限数给 0 */
export function detailNumber(event: Event): number {
  const value = detailOf(event).value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 取 `detail.value` 并断言成布尔；非布尔给 false */
export function detailBoolean(event: Event): boolean {
  return detailOf(event).value === true;
}
