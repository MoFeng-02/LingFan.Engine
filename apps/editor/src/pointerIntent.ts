/**
 * 指针交互判据（**纯函数，可测**）——拖拽阈值。
 *
 * 根因：`pointerdown` 与 `click` 在语义上无法区分时，会出现「一碰就被选中」，
 * 于是用户想拖也拖不动。
 *
 * 为什么阈值判据必须是**纯函数**（不写在组件里）：
 * 阈值是**契约的一部分**（几 px 算拖拽、单击仍须能选中），极易在调样式时被无意改掉。
 * 抽出来才能穷举断言：`<阈值 ⇒ 单击`、`≥阈值 ⇒ 拖拽`、斜向距离（用 hypot 而非单轴）。
 */

/** 拖拽阈值（px，业界惯例 4~5）—— 低于此位移视为「点击」而非「拖拽」 */
export const DRAG_THRESHOLD_PX = 4;

/** 拖拽判定的输入（只取需要的字段，便于测试构造） */
export interface DragProbe {
  readonly startX: number;
  readonly startY: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** 位移距离（**欧氏**，非单轴：斜向拖动单轴会误判成没动） */
export function dragDistance(probe: DragProbe): number {
  return Math.hypot(probe.clientX - probe.startX, probe.clientY - probe.startY);
}

/** 是否已达「拖拽」阈值（≥ 阈值）。`==` 阈值本身算拖拽（与业界惯例一致） */
export function isDragPastThreshold(probe: DragProbe, threshold = DRAG_THRESHOLD_PX): boolean {
  return dragDistance(probe) >= threshold;
}

/**
 * 交互意图判定：本次按下到当前位置应视为「拖拽」还是「点击」。
 * - `click`：未达阈值 ⇒ **只选中，不提交位移**
 * - `drag`：达阈值 ⇒ 提交位移
 */
export function interactionIntent(
  probe: DragProbe,
  threshold = DRAG_THRESHOLD_PX,
): "click" | "drag" {
  return isDragPastThreshold(probe, threshold) ? "drag" : "click";
}

/**
 * 是否应**抑制本次点击**（已判定为拖拽 ⇒ 不再叠加 click 的「选中」副作用）。
 *
 * 存在的意义：拖拽结束会紧跟一个 `click`（浏览器原生行为），若不抑制，
 * 元素会在落位后**再被选中一次**——在舞台里就会二次触发定位（`reveal`）跳走。
 */
export function shouldSuppressClick(probe: DragProbe, threshold = DRAG_THRESHOLD_PX): boolean {
  return isDragPastThreshold(probe, threshold);
}
