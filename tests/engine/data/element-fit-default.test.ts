/**
 * 元素填充「玩家默认槽」优先级测试（op 显式 > 玩家默认槽 > 内建 cover）。
 *
 * 填充方式承载玩法语义：作者把某张图声明成 contain 是为了让整幅画可见，玩家偏好
 * 只填作者**没声明**时的默认槽，绝不覆盖作者显式声明。本册钉死这条链，防止宿主
 * 把「玩家默认」误当成「玩家覆盖」——那会让作者的演出意图被偏好悄悄改写。
 *
 * 五类覆盖：多方位（五词 × 有无默认槽）、故意错误（词表外/非字符串仍走默认槽）、
 * 不变量（玩家默认永不压过 op 显式）、边界（空元素表/嵌套容器视频）。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEMENT_FIT,
  ELEMENT_FITS,
  elementFitOf,
  videoFitOf,
  type ElementFit,
  type ElementInstance,
} from "@lingfan-engine/core";

function instance(
  type: string,
  props: Record<string, unknown> = {},
  children: ElementInstance[] = [],
): ElementInstance {
  return { id: `${type}#1`, type, props, z: 0, children };
}

describe("elementFitOf：op 显式 > 玩家默认槽 > 内建 cover", () => {
  it("op 显式 stretch 恒赢玩家默认槽（五词逐一）", () => {
    for (const fit of ELEMENT_FITS) {
      // 玩家默认槽设成另一个词，op 显式仍须原样读出
      const other: ElementFit = fit === "cover" ? "contain" : "cover";
      expect(elementFitOf(fit, other)).toBe(fit);
    }
  });

  it("未写 stretch → 玩家默认槽填位", () => {
    expect(elementFitOf(undefined, "contain")).toBe("contain");
  });

  it("未写 stretch 且无玩家默认槽 → 内建 cover", () => {
    expect(elementFitOf(undefined)).toBe(DEFAULT_ELEMENT_FIT);
    expect(elementFitOf(undefined, undefined)).toBe(DEFAULT_ELEMENT_FIT);
  });

  it("词表外/非字符串 stretch → 玩家默认槽（而非直接内建）", () => {
    for (const raw of ["COVER", "object-fit", "", 1, true, null, {}]) {
      expect(elementFitOf(raw, "scale-down")).toBe("scale-down");
    }
    // 无默认槽时才落内建
    expect(elementFitOf("bogus")).toBe(DEFAULT_ELEMENT_FIT);
  });

  it("不变量：任意玩家默认槽都压不过 op 显式声明", () => {
    for (const declared of ELEMENT_FITS) {
      for (const playerDefault of ELEMENT_FITS) {
        expect(elementFitOf(declared, playerDefault)).toBe(declared);
      }
    }
  });
});

describe("videoFitOf：玩家默认槽经端口 fit 闭包注入", () => {
  it("无视频元素 → 玩家默认槽 / 内建", () => {
    const els = [instance("image", { stretch: "contain" })];
    expect(videoFitOf(els, "fill")).toBe("fill");
    expect(videoFitOf(els)).toBe(DEFAULT_ELEMENT_FIT);
    expect(videoFitOf([], "none")).toBe("none");
    expect(videoFitOf([])).toBe(DEFAULT_ELEMENT_FIT);
  });

  it("视频显式 stretch → 恒赢玩家默认槽", () => {
    const els = [instance("video", { stretch: "contain" })];
    expect(videoFitOf(els, "fill")).toBe("contain");
  });

  it("视频未写 stretch → 玩家默认槽填位", () => {
    const els = [instance("video", {})];
    expect(videoFitOf(els, "scale-down")).toBe("scale-down");
    expect(videoFitOf(els)).toBe(DEFAULT_ELEMENT_FIT);
  });

  it("嵌套容器里的视频同样算数（前序取第一个）", () => {
    const els = [
      instance("container", {}, [
        instance("image", {}),
        instance("video", { stretch: "none" }),
      ]),
    ];
    expect(videoFitOf(els, "fill")).toBe("none");
    const noStretch = [instance("container", {}, [instance("video", {})])];
    expect(videoFitOf(noStretch, "contain")).toBe("contain");
  });

  it("视频 stretch 写坏 → 玩家默认槽（不透传未知串）", () => {
    const els = [instance("video", { stretch: "COVER" })];
    expect(videoFitOf(els, "fill")).toBe("fill");
    expect(videoFitOf(els)).toBe(DEFAULT_ELEMENT_FIT);
  });
});
