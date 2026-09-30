/**
 * 舞台编辑：组件面板 → 舞台**落点创建**元素的纯逻辑。
 *
 * 与 `drag.ts`（移动已有元素）同域：DOM/事件留在组件，**判定与数值只在这里**——
 * - `createElementDraft`：新元素的**最小草稿**（`{type,x,y}`）——只含契约内、有渲染语义的
 *   属性，绝不含 `UNIMPLEMENTED_ELEMENT_ATTRS`（止血清单：写了也不生效的属性不给默认值）；
 *   未知类型 / 非有限坐标 fail-closed 返回 `null`（调用方忽略，不静默造坏节点）。
 * - `planElementDrop`：落点规划——命中容器（组件侧已按 DOM rect 判定）→ **进 `children`**
 *   且坐标换算为**相对容器原点**（与运行期渲染一致：子元素绝对定位于父容器内）；
 *   未命中 → 追加为顶级元素，落点即 `x`/`y`。
 */

import { ELEMENT_TYPES } from "@lingfan/engine";

/** 一次落点的规划结果：`parentIndex = null` → 顶级；否则 → 该下标容器的 `children`（坐标已换算为相对值） */
export interface ElementDropPlan {
  parentIndex: number | null;
  x: number;
  y: number;
}

/** 组件侧的容器命中信息（`index` = 顶级元素下标；`originX/Y` = 容器块在画布内容坐标系的原点） */
export interface DropContainerHit {
  index: number;
  originX: number;
  originY: number;
}

/**
 * 落点规划：未命中容器 → 顶级（坐标 = 画布内容坐标，四舍五入到整数像素，与拖拽位移同口径）；
 * 命中 → 相对容器原点取整。纯数值运算，DOM rect 的提取留在组件。
 */
export function planElementDrop(
  x: number,
  y: number,
  container: DropContainerHit | undefined,
): ElementDropPlan {
  if (container === undefined) {
    return { parentIndex: null, x: Math.round(x), y: Math.round(y) };
  }
  return {
    parentIndex: container.index,
    x: Math.round(x - container.originX),
    y: Math.round(y - container.originY),
  };
}

/**
 * 新元素草稿：**最小面** `{type, x, y}`（数字坐标；id 缺省 = 运行期 `{列id}#{序号}` 寻址，
 * 不在创建期生成，避免撞号逻辑）。
 */
export function createElementDraft(
  type: string,
  x: number,
  y: number,
): Record<string, unknown> | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!(ELEMENT_TYPES as readonly string[]).includes(type)) return null;
  return { type, x: Math.round(x), y: Math.round(y) };
}
