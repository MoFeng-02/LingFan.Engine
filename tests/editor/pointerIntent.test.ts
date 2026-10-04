/**
 * 指针交互判据（**边界条件** + **严格多方位** + **不变量**）—— D-63 修法 (b)。
 *
 * 阈值是契约的一部分（几 px 算拖拽、单击仍须能选中），因此必须能穷举断言。
 * 特别覆盖**斜向**（用 `hypot` 而非单轴判定）与**恰好等于阈值**的边界。
 */
import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  dragDistance,
  interactionIntent,
  isDragPastThreshold,
  shouldSuppressClick,
  type DragProbe,
} from "../../apps/editor/src/pointerIntent";

const probe = (dx: number, dy = 0): DragProbe => ({
  startX: 100,
  startY: 100,
  clientX: 100 + dx,
  clientY: 100 + dy,
});

describe("拖拽阈值 · 边界条件", () => {
  it("零位移 = 点击（用户只想点一下）", () => {
    expect(dragDistance(probe(0))).toBe(0);
    expect(interactionIntent(probe(0))).toBe("click");
    expect(shouldSuppressClick(probe(0))).toBe(false);
  });

  it("恰好等于阈值 ⇒ 算拖拽（与业界惯例一致）", () => {
    expect(isDragPastThreshold(probe(DRAG_THRESHOLD_PX))).toBe(true);
    expect(interactionIntent(probe(DRAG_THRESHOLD_PX))).toBe("drag");
  });

  it("差一像素 ⇒ 算点击（阈值是硬边界，不含糊）", () => {
    expect(interactionIntent(probe(DRAG_THRESHOLD_PX - 1))).toBe("click");
  });

  it("远超阈值 ⇒ 拖拽", () => {
    expect(interactionIntent(probe(500, 0))).toBe("drag");
    expect(shouldSuppressClick(probe(500, 0))).toBe(true);
  });

  it("阈值为业界惯例区间（4~5px）", () => {
    expect(DRAG_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(DRAG_THRESHOLD_PX).toBeLessThanOrEqual(5);
  });
});

describe("拖拽阈值 · 斜向必须按欧氏距离（严格多方位）", () => {
  it("斜向 3/3px（单轴都 <4，欧氏 >4）⇒ 判拖拽", () => {
    const p = probe(3, 3);
    expect(dragDistance(p)).toBeCloseTo(Math.hypot(3, 3), 6);
    // 单轴判定会误判成"没动"，欧氏才正确
    expect(isDragPastThreshold(p)).toBe(true);
  });

  it("反向斜向同样成立（负 dx/dy）", () => {
    const p = probe(-3, -3);
    expect(dragDistance(p)).toBeCloseTo(Math.hypot(3, 3), 6);
    expect(interactionIntent(p)).toBe("drag");
  });

  it("斜向 2/2px（欧氏 2.83 < 4）⇒ 仍是点击", () => {
    const p = probe(2, 2);
    expect(dragDistance(p)).toBeLessThan(DRAG_THRESHOLD_PX);
    expect(interactionIntent(p)).toBe("click");
  });

  it("横竖与斜向同距离等价（各向同性，不偏袒某方向）", () => {
    expect(dragDistance(probe(5, 0))).toBeCloseTo(dragDistance(probe(3, 4)), 6);
    expect(interactionIntent(probe(3, 4))).toBe(interactionIntent(probe(5, 0)));
  });
});

describe("拖拽阈值 · 边界不变量（混沌式不变量抽样）", () => {
  it("任何位移 ≥ 阈值 ⇒ 判拖拽（单调性不破）", () => {
    // 种子化抽样：固定序列（非随机 ⇒ 可复现）。
    // ⚠️ 浮点：用 `cos/sin` 换算出的分量会让「构造上等于阈值」的实际距离
    //    略低于阈值（1e-16 级）⇒ 采样留 0.01 余量，不拿浮点误差当契约。
    const margin = 0.01;
    for (let step = 0; step < 200; step += 1) {
      const angle = (step / 200) * Math.PI * 2;
      const dist = DRAG_THRESHOLD_PX + margin + (step % 17);
      const p = probe(Math.cos(angle) * dist, Math.sin(angle) * dist);
      expect(dragDistance(p)).toBeGreaterThanOrEqual(DRAG_THRESHOLD_PX);
      expect(interactionIntent(p)).toBe("drag");
    }
  });

  it("任何位移 < 阈值 ⇒ 判点击（含零与负方向）", () => {
    for (let step = 0; step < 200; step += 1) {
      const angle = (step / 200) * Math.PI * 2;
      const dist = (step % 7) / 2 - 0.01; // ≤3 且留余量
      const p = probe(Math.cos(angle) * dist, Math.sin(angle) * dist);
      expect(dragDistance(p)).toBeLessThan(DRAG_THRESHOLD_PX);
      expect(interactionIntent(p)).toBe("click");
    }
  });

  it("`shouldSuppressClick` 与 `interactionIntent` 判定**恒一致**（不变量）", () => {
    for (let step = -20; step <= 20; step += 1) {
      const p = probe(step, step);
      const intent = interactionIntent(p);
      const suppressed = shouldSuppressClick(p);
      expect(suppressed).toBe(intent === "drag");
    }
  });

  it("超大位移（1e6）不溢出、不抛（极端输入 fail-safe）", () => {
    const p = probe(1e6, 1e6);
    expect(Number.isFinite(dragDistance(p))).toBe(true);
    expect(interactionIntent(p)).toBe("drag");
  });
});
