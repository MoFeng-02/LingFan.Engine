/**
 * 码元序比较器：判据是「比较结果只由码元决定」，不随宿主 locale 变。
 *
 * 这层断言守的是构建确定性——构建产物里的排序（角色前置、函数分组、诊断列表、
 * import 语句、资源根定位、字体注册表）全部走这里，一旦有人换回 `localeCompare`，
 * 中文开发机与英文构建机会排出不同顺序，产物字节就分叉了。
 */
import { describe, expect, it } from "vitest";
import { compareOrdinal } from "@lingfan-engine/core";

describe("compareOrdinal · 码元序", () => {
  it("相等串返回 0", () => {
    expect(compareOrdinal("", "")).toBe(0);
    expect(compareOrdinal("say", "say")).toBe(0);
  });

  it("ASCII 按码元比较，与字典常识一致", () => {
    expect(compareOrdinal("a", "b")).toBeLessThan(0);
    expect(compareOrdinal("b", "a")).toBeGreaterThan(0);
    expect(compareOrdinal("Z", "a")).toBeLessThan(0); // U+005A < U+0061
    expect(compareOrdinal("a10", "a9")).toBeLessThan(0); // 逐位比，不做数字感知
  });

  it("前缀短串在前", () => {
    expect(compareOrdinal("ab", "abc")).toBeLessThan(0);
    expect(compareOrdinal("abc", "ab")).toBeGreaterThan(0);
  });

  it("汉字按码元排，不按拼音或 ICU 规则", () => {
    // 甲 U+7532 / 乙 U+4E59：ICU 中文排序会把 甲 排在前，码元序则 乙 在前
    expect(compareOrdinal("乙", "甲")).toBeLessThan(0);
    expect(compareOrdinal("甲", "乙")).toBeGreaterThan(0);
  });

  it("与运行时 locale 无关：换掉 locale 后顺序不变", () => {
    const pairs: [string, string][] = [
      ["乙", "甲"],
      ["Z", "a"],
      ["_", "a"],
      ["é", "e"],
    ];
    const before = pairs.map(([a, b]) => Math.sign(compareOrdinal(a, b)));
    const original = Object.getOwnPropertyDescriptor(
      String.prototype,
      "localeCompare",
    );
    try {
      // 把 localeCompare 打成「全反序」的假实现：只要实现里偷偷用了它，下面的断言必红
      String.prototype.localeCompare = function reversed(): number {
        return 1;
      } as typeof String.prototype.localeCompare;
      const after = pairs.map(([a, b]) => Math.sign(compareOrdinal(a, b)));
      expect(after).toEqual(before);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(String.prototype, "localeCompare", original);
      }
    }
  });

  it("与数组默认 sort 同一口径", () => {
    const keys = ["乙", "甲", "a", "Z", "_", "a9", "a10"];
    expect([...keys].sort(compareOrdinal)).toEqual([...keys].sort());
  });
});
