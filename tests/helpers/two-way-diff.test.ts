/**
 * 共享互锁断言 `twoWayDiff` / `expectTwoWayEqual` 的单元测试：
 * 差集方向、去重语义、断言失败路径都要覆盖——它是锚点面与元素面互锁的地基。
 */
import { describe, expect, it } from "vitest";
import { expectTwoWayEqual, twoWayDiff } from "./two-way-diff";

describe("twoWayDiff（纯计算版）", () => {
  it("两侧精确相等 = 双差集皆空", () => {
    const r = twoWayDiff({
      declared: ["a", "b"],
      landed: ["b", "a"],
      declaredLabel: "声明",
      landedLabel: "落地",
    });
    expect(r.declaredButMissing).toEqual([]);
    expect(r.landedButUndeclared).toEqual([]);
  });

  it("声明有落地没有 → declaredButMissing（声明未落地）", () => {
    const r = twoWayDiff({
      declared: ["a", "b", "c"],
      landed: ["a"],
      declaredLabel: "声明",
      landedLabel: "落地",
    });
    expect(r.declaredButMissing).toEqual(["b", "c"]);
    expect(r.landedButUndeclared).toEqual([]);
  });

  it("落地有声明没有 → landedButUndeclared（写法漂移信号）", () => {
    const r = twoWayDiff({
      declared: ["a"],
      landed: ["a", "x", "y"],
      declaredLabel: "声明",
      landedLabel: "落地",
    });
    expect(r.declaredButMissing).toEqual([]);
    expect(r.landedButUndeclared).toEqual(["x", "y"]);
  });

  it("两侧重复项按集合语义去重，不影响结果", () => {
    const r = twoWayDiff({
      declared: ["a", "a", "b"],
      landed: ["b", "b", "a"],
      declaredLabel: "声明",
      landedLabel: "落地",
    });
    expect(r.declaredButMissing).toEqual([]);
    expect(r.landedButUndeclared).toEqual([]);
  });

  it("任意一侧为空集也能算（首次接入时声明或落地为空的合法起点）", () => {
    const r = twoWayDiff({
      declared: [],
      landed: ["x"],
      declaredLabel: "声明",
      landedLabel: "落地",
    });
    expect(r.declaredButMissing).toEqual([]);
    expect(r.landedButUndeclared).toEqual(["x"]);
  });
});

describe("expectTwoWayEqual（断言版）", () => {
  it("相等时静默通过", () => {
    expect(() =>
      expectTwoWayEqual({
        declared: ["a"],
        landed: ["a"],
        declaredLabel: "声明",
        landedLabel: "落地",
      }),
    ).not.toThrow();
  });

  it("单侧缺失时失败消息含差集与两侧标签（可读性 = 报告的落点）", () => {
    expect(() =>
      expectTwoWayEqual({
        declared: ["a", "missing-one"],
        landed: ["a", "extra-one"],
        declaredLabel: "规约锚点",
        landedLabel: "测试落地",
      }),
    ).toThrowError(
      /规约锚点有而测试落地没有.*missing-one[\s\S]*测试落地有而规约锚点没有.*extra-one/,
    );
  });
});
