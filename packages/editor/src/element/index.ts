/**
 * 元素编辑域出口：舞台拖拽的位移换算与拖放落点规划（纯函数，可测）。
 * 只有数字坐标参与像素拖拽；百分比等 CSS 长度保持原值不动。
 */
export { parseNumericPosition, draggedPosition } from "./drag";
export {
  planElementDrop,
  createElementDraft,
  type ElementDropPlan,
  type DropContainerHit,
} from "./dragCreate";
