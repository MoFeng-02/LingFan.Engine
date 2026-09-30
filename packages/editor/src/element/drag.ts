/**
 * 舞台编辑：拖拽位移 → 新坐标（纯函数，可测）。
 *
 * 元素 `x`/`y` 可为数字（px）或 CSS 长度串（如 `"50%"`）。**只有数字参与像素拖拽**：
 * 百分比 / `calc()` / `em` 等无法与像素位移相加，拖拽时保持原值不动
 * （改这类值请用属性面板显式输入）——静默改成 px 会丢失作者意图。
 */

/** 数值坐标（非有限数字 → null） */
export function parseNumericPosition(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 拖拽落点：基准值可拖（数字或缺失）→ 新数值（四舍五入到整数像素）；
 * 字符串坐标 → `null`（调用方**保持原值**，不写回）。
 */
export function draggedPosition(base: unknown, delta: number): number | null {
  if (typeof base === "string" && base !== "") return null;
  const start = parseNumericPosition(base) ?? 0;
  return Math.round(start + delta);
}
