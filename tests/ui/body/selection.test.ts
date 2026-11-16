/**
 * 身体选择的判据：`SYS.body` 的原始值 + 组件表 → 这一屏渲染谁、带什么入参。
 *
 * 这一层判的是「三种宿主会不会渲染出不同的组件」——所以断言都对着
 * 「一种形态静默不画、另一种抛错」这类会分裂成三套现象的地方写。
 * 全部纯内存，不碰 DOM 也不碰引擎实例。
 */
import { describe, expect, it, vi } from "vitest";
import { selectBody } from "@lingfan-engine/ui";

describe("selectBody：有身体就选出组件", () => {
  it("带名字与入参：组件取自表，入参原样带上", () => {
    const kitchen = { setup: true };
    expect(
      selectBody({ name: "kitchen", props: { mood: "dim" } }, { kitchen }),
    ).toEqual({ name: "kitchen", component: kitchen, props: { mood: "dim" } });
  });

  it("没写入参时给空对象（宿主不必再判 undefined）", () => {
    const kitchen = {};
    expect(selectBody({ name: "kitchen" }, { kitchen })).toEqual({
      name: "kitchen",
      component: kitchen,
      props: {},
    });
  });

  it("入参是同一个引用（不做拷贝，免得每帧都判成变化）", () => {
    const props = { mood: "dim" };
    const picked = selectBody({ name: "kitchen", props }, { kitchen: {} });
    expect(picked?.props).toBe(props);
  });

  it("同名的另一份状态选中同一张表项（表是唯一查表面）", () => {
    const kitchen = { marker: 1 };
    expect(
      selectBody({ name: "kitchen", props: { hp: 1 } }, { kitchen })?.component,
    ).toBe(kitchen);
    expect(
      selectBody({ name: "kitchen", props: { hp: 2 } }, { kitchen })?.component,
    ).toBe(kitchen);
  });
});

describe("selectBody：没有身体就不渲染", () => {
  it("键不存在（`undefined`）与脏值一样：返回 null", () => {
    expect(selectBody(undefined, { kitchen: {} })).toBeNull();
  });

  it("显式 null 也返回 null", () => {
    expect(selectBody(null, { kitchen: {} })).toBeNull();
  });
});

describe("selectBody：脏数据不查表也不上报", () => {
  const onMissing = () => {
    throw new Error("脏数据不该触发上报");
  };

  it.each([
    ["字符串", "kitchen"],
    ["数组", ["kitchen"]],
    ["数字", 1],
    ["缺 name", { props: {} }],
    ["name 不是字符串", { name: 1 }],
    ["props 是数组", { name: "kitchen", props: [] }],
    ["props 是 null", { name: "kitchen", props: null }],
    ["props 是字符串", { name: "kitchen", props: "dim" }],
  ])("%s ⇒ null，且不调 onMissing", (_label, raw) => {
    const spy = vi.fn(onMissing);
    expect(selectBody(raw, { kitchen: {} }, spy)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("selectBody：表里缺组件一律 fail-closed", () => {
  it("缺名字时返回 null 并上报该名字", () => {
    const onMissing = vi.fn();
    expect(
      selectBody({ name: "ghost" }, { kitchen: {} }, onMissing),
    ).toBeNull();
    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onMissing).toHaveBeenCalledWith("ghost");
  });

  it("没注入上报口时只返回 null（不抛）", () => {
    expect(selectBody({ name: "ghost" }, {})).toBeNull();
  });

  it("表项值为 undefined 与缺键同等处理", () => {
    const onMissing = vi.fn();
    expect(
      selectBody({ name: "ghost" }, { ghost: undefined }, onMissing),
    ).toBeNull();
    expect(onMissing).toHaveBeenCalledWith("ghost");
  });

  it("表项是 null 时不算缺失（作者可能真要渲染一个空值）", () => {
    expect(selectBody({ name: "ghost" }, { ghost: null })).toEqual({
      name: "ghost",
      component: null,
      props: {},
    });
  });
});
