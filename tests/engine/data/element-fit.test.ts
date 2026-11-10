/**
 * 元素填充方式读数测试。
 *
 * `elementFitOf` / `videoFitOf` 是宿主注入端口 `fit` 闭包时的唯一读法：
 * 三个端（Web 模板、桌面壳、小程序）都从这里取，故语义边界都钉在这里——
 * 缺失、写坏、词表外一律回缺省，找不到视频也回缺省，都不抛。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ELEMENT_FIT,
  ELEMENT_FITS,
  ELEMENT_SPECIFIC_ATTRS,
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

describe("elementFitOf", () => {
  it("五个词原样读出（词表内不做映射）", () => {
    for (const fit of ELEMENT_FITS) {
      expect(elementFitOf({ stretch: fit }), fit).toBe(fit);
    }
  });

  it("未写 stretch → 缺省词", () => {
    expect(elementFitOf({})).toBe(DEFAULT_ELEMENT_FIT);
    expect(elementFitOf({ source: "Images/a.png" })).toBe(DEFAULT_ELEMENT_FIT);
  });

  it("词表外的字符串 → 缺省词（不透传未知串，三端才有一致的兜底）", () => {
    for (const raw of ["COVER", "object-fit", "fill ", "", "stretch"]) {
      expect(elementFitOf({ stretch: raw }), raw).toBe(DEFAULT_ELEMENT_FIT);
    }
  });

  it("非字符串 → 缺省词（属性值来自作者数据，不抛）", () => {
    for (const raw of [1, true, null, undefined, {}, []]) {
      expect(elementFitOf({ stretch: raw })).toBe(DEFAULT_ELEMENT_FIT);
    }
  });
});

describe("videoFitOf", () => {
  it("命中视频元素 → 读它的 stretch", () => {
    const own: ElementFit = "contain";
    expect(
      videoFitOf([instance("image"), instance("video", { stretch: own })]),
    ).toBe(own);
  });

  it("元素表里没有视频 → 缺省词", () => {
    expect(videoFitOf([])).toBe(DEFAULT_ELEMENT_FIT);
    expect(videoFitOf([instance("image", { stretch: "fill" })])).toBe(
      DEFAULT_ELEMENT_FIT,
    );
  });

  it("视频藏在容器 children 里也算命中（递归覆盖）", () => {
    const nested = instance("video", { stretch: "none" });
    expect(
      videoFitOf([instance("vbox", {}, [instance("panel"), nested])]),
    ).toBe("none");
  });

  it("多个视频取前序第一个（呈现层一屏只有一个视频端口）", () => {
    const first: ElementFit = "fill";
    const second: ElementFit = "scale-down";
    expect(
      videoFitOf([
        instance("video", { stretch: first }),
        instance("video", { stretch: second }),
      ]),
    ).toBe(first);
    expect(
      videoFitOf([
        instance("vbox", {}, [instance("video", { stretch: first })]),
        instance("video", { stretch: second }),
      ]),
    ).toBe(first);
  });

  it("视频存在但没写 stretch → 缺省词（不是「没找到」）", () => {
    expect(videoFitOf([instance("video")])).toBe(DEFAULT_ELEMENT_FIT);
  });
});

describe("contracts：分类型属性声明", () => {
  it("吃 stretch 的元素类型都声明了它（背景元素同样消费，别漏）", () => {
    for (const type of [
      "image",
      "imagebutton",
      "portrait",
      "background",
      "video",
    ]) {
      expect(ELEMENT_SPECIFIC_ATTRS[type], type).toContain("stretch");
    }
  });
});
