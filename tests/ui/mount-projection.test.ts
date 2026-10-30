/**
 * 挂载投影与差量的判据：`SYS.mounts` 的原始值 → 可见集合 / 入参 / 差量。
 *
 * 这一层是三种宿主形态的共同底座，所以每条断言都对着「三形态会一起错」的地方写：
 * 顺序、脏值、入参替换语义。全部纯内存，不碰 DOM 也不碰引擎实例。
 */
import { describe, expect, it } from "vitest";
import {
  mountEntryOf,
  mountProps,
  planMounts,
  visibleMounts,
} from "@lingfan-engine/ui";

/** 造一条挂载记录 */
function entry(
  visible: boolean,
  props: Record<string, unknown> = {},
): { visible: boolean; props: Record<string, unknown> } {
  return { visible, props };
}

describe("visibleMounts：从原始值投影可见集合", () => {
  it("空表与未定义都投影成空集合", () => {
    expect(visibleMounts(undefined)).toEqual([]);
    expect(visibleMounts(null)).toEqual([]);
    expect(visibleMounts({})).toEqual([]);
  });

  it("只收 visible: true 的名字", () => {
    const raw = {
      hub: entry(true),
      map: entry(false),
      bag: entry(true),
    };
    expect(visibleMounts(raw)).toEqual(["bag", "hub"]);
  });

  it("顺序是码点序而不是对象键序（同一份状态必得同一串挂载动作）", () => {
    const raw = {
      zeta: entry(true),
      alpha: entry(true),
      mid: entry(true),
    };
    expect(visibleMounts(raw)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("脏值一律按空表处理，不抛错也不卡死渲染", () => {
    for (const dirty of [
      [],
      "hub",
      42,
      { hub: true },
      { hub: { visible: "yes", props: {} } },
      { hub: { visible: true } },
      { Hub: entry(true) },
      { "bad name": entry(true) },
    ]) {
      expect(() => visibleMounts(dirty)).not.toThrow();
      expect(visibleMounts(dirty)).toEqual([]);
    }
  });

  it("props 原样透传（同一份引用，只读）", () => {
    const props = { scene: "forest", depth: 3 };
    const raw = { map: entry(true, props) };
    expect(mountProps(raw, "map")).toBe(props);
    expect(mountProps(raw, "hub")).toBeUndefined();
    expect(mountProps(raw, "map")).toEqual({ scene: "forest", depth: 3 });
  });

  it("不可见的 UI 取不到入参（隐藏即卸载，组件不该拿到 props）", () => {
    const raw = { hub: entry(false, { scene: "inn" }) };
    expect(mountProps(raw, "hub")).toBeUndefined();
    expect(mountEntryOf(raw, "hub")).toBeUndefined();
  });

  it("可见时 mountEntryOf 一次给出显隐与入参", () => {
    const raw = { hub: entry(true, { scene: "inn" }) };
    expect(mountEntryOf(raw, "hub")).toEqual({
      visible: true,
      props: { scene: "inn" },
    });
  });
});

describe("planMounts：两帧之间的差量", () => {
  it("首帧：全部是新挂载", () => {
    const plan = planMounts(undefined, {
      hub: entry(true),
      map: entry(true),
    });
    expect(plan).toEqual({ unmount: [], mount: ["hub", "map"], update: [] });
  });

  it("两帧相同：空差量（不重渲染任何东西）", () => {
    const raw = { hub: entry(true, { scene: "inn" }) };
    expect(planMounts(raw, raw)).toEqual({
      unmount: [],
      mount: [],
      update: [],
    });
    // 内容相同但不是同一引用：仍然不该判成变化
    const copy = { hub: entry(true, { scene: "inn" }) };
    expect(planMounts(raw, copy).update).toEqual([]);
  });

  it("隐藏 = 卸载（不是改属性）", () => {
    const before = { hub: entry(true), map: entry(true) };
    const after = { hub: entry(false), map: entry(true) };
    expect(planMounts(before, after)).toEqual({
      unmount: ["hub"],
      mount: [],
      update: [],
    });
  });

  it("入参变化：整份重挂（不浅合并）", () => {
    const before = { map: entry(true, { scene: "inn", depth: 1 }) };
    const after = { map: entry(true, { scene: "forest" }) };
    expect(planMounts(before, after)).toEqual({
      unmount: [],
      mount: [],
      update: ["map"],
    });
  });

  it("入参键序不同但内容相同：不算变化", () => {
    const before = { map: entry(true, { a: 1, b: 2 }) };
    const after = { map: entry(true, { b: 2, a: 1 }) };
    expect(planMounts(before, after).update).toEqual([]);
  });

  it("嵌套入参按内容比较（数组与对象的键序都不影响判定）", () => {
    const before = {
      map: entry(true, { list: [1, 2], nested: { x: 1, y: 2 } }),
    };
    const after = {
      map: entry(true, { nested: { y: 2, x: 1 }, list: [1, 2] }),
    };
    expect(planMounts(before, after).update).toEqual([]);
    const changed = { map: entry(true, { list: [1, 3] }) };
    expect(planMounts(before, changed).update).toEqual(["map"]);
  });

  it("两帧都空或都是脏值：空差量且不抛", () => {
    expect(planMounts(undefined, {})).toEqual({
      unmount: [],
      mount: [],
      update: [],
    });
    expect(() => planMounts("坏值", 42)).not.toThrow();
    expect(planMounts("坏值", 42).mount).toEqual([]);
  });
});
