/**
 * 对齐吸附判据测试（**边界条件** + **多方位** + **不变量**）—— UI 改造步 4。
 */
import { describe, expect, it } from "vitest";
import { nearestSnap, SNAP_THRESHOLD_PX, snapGuides } from "../../apps/editor/src/snapGuides";

describe("最近线吸附", () => {
  it("阈值内命中最近的那条（不是第一条）", () => {
    // 候选 100 与 103，从 102 出发：100 距离 2、103 距离 1 ⇒ 取 103
    expect(nearestSnap(102, [100, 103])).toBe(103);
    expect(nearestSnap(102, [100])).toBe(100);
  });

  it("超出阈值 ⇒ 不命中（null）", () => {
    expect(nearestSnap(102, [200])).toBeNull();
    expect(nearestSnap(0, [SNAP_THRESHOLD_PX + 1])).toBeNull();
  });

  it("恰好等于阈值 ⇒ 命中（边界闭合）", () => {
    expect(nearestSnap(0, [SNAP_THRESHOLD_PX])).toBe(SNAP_THRESHOLD_PX);
  });

  it("空候选 ⇒ null（只有一个元素时不显示参考线）", () => {
    expect(nearestSnap(10, [])).toBeNull();
  });
});

describe("拖拽参考线（元素三关键线：左/中/右 · 上/中/下）", () => {
  const others = { v: [100, 300], h: [200, 400] };
  const box = { x: 102, y: 198, width: 40, height: 20 };

  it("左边缘接近竖线 ⇒ 给出参考线", () => {
    expect(snapGuides(box, others).vx).toBe(100);
  });

  it("中心接近竖线 ⇒ 也给出（不必是左边缘）", () => {
    // 中心 x = 102 + 20 = 122，构造一个 122±2 的候选
    const r = snapGuides({ ...box, x: 100 }, { v: [121], h: [] });
    expect(r.vx).toBe(121);
  });

  it("上边缘接近横线 ⇒ 给出横线参考", () => {
    expect(snapGuides(box, others).hy).toBe(200);
  });

  it("两个方向都命中 ⇒ 两条都出", () => {
    const r = snapGuides(box, others);
    expect(r.vx).toBe(100);
    expect(r.hy).toBe(200);
  });

  it("都不靠近 ⇒ 两条都 null（不显示参考线）", () => {
    const r = snapGuides({ x: 900, y: 900, width: 40, height: 20 }, others);
    expect(r.vx).toBeNull();
    expect(r.hy).toBeNull();
  });

  it("阈值可覆盖（不同元素可调吸附强度）", () => {
    const r = snapGuides(box, { v: [90], h: [] }, 20);
    expect(r.vx).toBe(90);
  });

  it("**只提示不改坐标**：判据不返回修正量（避免静默改作者意图）", () => {
    const r = snapGuides(box, others);
    // 返回值只有参考线位置，没有"应该改成多少"
    expect(Object.keys(r).sort()).toEqual(["hy", "vx"]);
  });
});
