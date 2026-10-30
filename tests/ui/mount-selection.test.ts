/**
 * 挂载选择与订阅的判据：「可见集合 + 名字 → 组件表」合成渲染清单，以及三形态共用的订阅通路。
 *
 * 这一层判的是「三种宿主会不会挂出不同的组件集合」——所以每条断言都对着
 * 「一种形态静默跳过、另一种抛错」这类会分裂成三套现象的地方写。
 * 全部纯内存，不碰 DOM 也不碰引擎实例。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createMountStore,
  missingMounts,
  selectMounts,
  visibleMounts,
} from "@lingfan-engine/ui";

/** 造一条挂载记录 */
function entry(
  visible: boolean,
  props: Record<string, unknown> = {},
): { visible: boolean; props: Record<string, unknown> } {
  return { visible, props };
}

describe("selectMounts：可见集合 + 组件表 → 渲染清单", () => {
  it("按码点序铺开，带组件本身与该 UI 的完整入参", () => {
    const hub = { kind: "component" };
    const map = { kind: "component" };
    const raw = {
      hub: entry(true, { scene: "inn" }),
      map: entry(true),
    };
    expect(selectMounts(raw, { hub, map })).toEqual([
      { name: "hub", component: hub, props: { scene: "inn" } },
      { name: "map", component: map, props: {} },
    ]);
  });

  it("不可见的 UI 不出现在清单里（隐藏即不渲染，不是藏起来）", () => {
    const raw = { hub: entry(false), map: entry(true) };
    const items = selectMounts(raw, { hub: {}, map: {} });
    expect(items.map((item) => item.name)).toEqual(["map"]);
  });

  it("表里没有这个名字：跳过那一条并逐条上报，其余照常渲染", () => {
    const onMissing = vi.fn();
    const raw = { ghost: entry(true), hub: entry(true) };
    const items = selectMounts(raw, { hub: {} }, onMissing);
    expect(items.map((item) => item.name)).toEqual(["hub"]);
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith("ghost");
  });

  it("脏值按空表：不抛，清单为空", () => {
    expect(selectMounts("坏值", { hub: {} })).toEqual([]);
    expect(selectMounts(undefined, {})).toEqual([]);
  });

  it("入参是同一个引用（不做拷贝，免得每帧都判成变化）", () => {
    const props = { scene: "inn" };
    const items = selectMounts({ hub: entry(true, props) }, { hub: {} });
    expect(items[0]?.props).toBe(props);
  });
});

describe("missingMounts：稳定差集，供声明式宿主自己控制上报时机", () => {
  it("只报可见且取不到组件的名字", () => {
    const raw = { ghost: entry(true), hidden: entry(false), hub: entry(true) };
    expect(missingMounts(raw, { hub: {} })).toEqual(["ghost"]);
  });

  it("脏值按空表：没有「缺什么」可言", () => {
    expect(missingMounts("坏值", {})).toEqual([]);
  });
});

describe("createMountStore：三形态共用的订阅通路", () => {
  it("订阅时不回放历史，调用方先自己读一次快照", () => {
    const store = createMountStore({ hub: entry(true) });
    const seen = vi.fn();
    store.subscribe(seen);
    expect(seen).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({ hub: entry(true) });
  });

  it("写入同一个引用不通知（引擎写侧本就是整表新建）", () => {
    const raw = { hub: entry(true) };
    const store = createMountStore(raw);
    const seen = vi.fn();
    store.subscribe(seen);
    store.set(raw);
    expect(seen).not.toHaveBeenCalled();
  });

  it("写入新值通知全部监听器，退订后不再通知", () => {
    const store = createMountStore();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = store.subscribe(first);
    store.subscribe(second);

    store.set({ hub: entry(true) });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    offFirst();
    store.set({ hub: entry(false) });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("监听器里退订自己不会跳过后一个（遍历的是快照）", () => {
    const store = createMountStore();
    const second = vi.fn();
    const offFirst = store.subscribe(() => offFirst());
    store.subscribe(second);
    store.set({ hub: entry(true) });
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("投影与选择对同一份状态给同一个可见集合", () => {
  it("selectMounts 的名字序列恒等于 visibleMounts（三形态不会各挂一套）", () => {
    const raw = {
      zeta: entry(true),
      alpha: entry(true),
      mid: entry(false),
    };
    const table = { zeta: {}, alpha: {}, mid: {} };
    expect(selectMounts(raw, table).map((item) => item.name)).toEqual(
      visibleMounts(raw),
    );
  });
});
