/**
 * 舞台拖拽的**对齐吸附判据**（纯函数，可测）。
 *
 * 为何要它（不是"锦上添花"）：没有吸附时，元素只能靠肉眼拖到"大概对齐"，
 * 而画布是**百分比坐标**（`x: "5%"`），拖手的 1px 与坐标的 1% 并不对应
 * ⇒ 用户要么对不齐，要么反复微调。吸附线把"对齐"变成**可见反馈**。
 *
 * **只提示不吸附**：命中时返回参考线位置（给用户看），但**不修改**最终坐标 ——
 *    静默改坐标会让"我拖到这儿"与"它落到那儿"不一致（作者意图被改写）。
 */

/** 参与吸附的候选线（画布坐标系，px） */
export interface SnapCandidate {
  /** 竖线（x）的位置集合：元素的 left / 中心 / right */
  readonly v: readonly number[];
  /** 横线（y）的位置集合：元素的 top / 中心 / bottom */
  readonly h: readonly number[];
}

/** 吸附命中结果 */
export interface SnapResult {
  /** 命中的竖线位置（画布坐标；`null` = 没命中） */
  readonly vx: number | null;
  /** 命中的横线位置 */
  readonly hy: number | null;
}

/** 命中阈值（px）：小于它算"对齐了"，与 `DRAG_THRESHOLD_PX`（起拖阈值）不同量纲 */
export const SNAP_THRESHOLD_PX = 5;

/**
 * 找出离 `pos` 最近的候选线（**在阈值内**才算命中）。
 *
 * 多个候选都在阈值内时取**最近的那个**（不是第一个）——
 * 否则元素从右往左拖时，参考线会跳到另一条。
 */
export function nearestSnap(pos: number, candidates: readonly number[], threshold = SNAP_THRESHOLD_PX): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const c of candidates) {
    const d = Math.abs(c - pos);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 算出拖拽中元素应显示的参考线位置。
 *
 * @param box 拖拽中元素的矩形（画布坐标）
 * @param others **其它**元素（不含被拖的那个）的候选线
 */
export function snapGuides(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  others: SnapCandidate,
  threshold = SNAP_THRESHOLD_PX,
): SnapResult {
  const xs = [box.x, box.x + box.width / 2, box.x + box.width];
  const ys = [box.y, box.y + box.height / 2, box.y + box.height];
  const vx = nearestSnap2(xs, others.v, threshold);
  const hy = nearestSnap2(ys, others.h, threshold);
  return { vx, hy };
}

/** 从"被拖元素的三个关键 x"里找任一命中（命中即给参考线） */
function nearestSnap2(probes: readonly number[], candidates: readonly number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const p of probes) {
    for (const c of candidates) {
      const d = Math.abs(c - p);
      if (d <= bestDist) {
        best = c;
        bestDist = d;
      }
    }
  }
  return best;
}
