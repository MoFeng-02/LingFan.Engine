/**
 * 版本运算的判据。
 *
 * 只钉三件事：解析的严格程度、比较的排序（含预发布）、区间下界的取法。
 * 排序错一位，生成期就会在「该失败时放过」或「该放过时失败」两头都出错，
 * 而这两种错都不会在编译期露头。
 */
import { describe, expect, it } from "vitest";
import {
  compareSemver,
  floorOfRange,
  meetsMinimum,
  parseSemver,
} from "../../packages/create/src/shared/semver.ts";

describe("parseSemver", () => {
  it("拆出主次修订", () => {
    expect(parseSemver("0.3.0")).toEqual({ major: 0, minor: 3, patch: 0 });
    expect(parseSemver("12.34.56")).toEqual({
      major: 12,
      minor: 34,
      patch: 56,
    });
  });

  it("带预发布时保留后缀", () => {
    expect(parseSemver("0.3.0-rc.1")).toEqual({
      major: 0,
      minor: 3,
      patch: 0,
      prerelease: "rc.1",
    });
  });

  it.each(["v0.3.0", "0.3", "0.3.0.1", "0.3.0+build.5", "01.0.0", "", "abc"])(
    "拒绝非法写法 %s",
    (text) => {
      expect(parseSemver(text)).toBeUndefined();
    },
  );
});

describe("compareSemver", () => {
  it("按主次修订逐位比较", () => {
    expect(compareSemver("0.2.0", "0.3.0")).toBe(-1);
    expect(compareSemver("0.3.0", "0.2.9")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("预发布小于同号正式版", () => {
    expect(compareSemver("0.3.0-rc.1", "0.3.0")).toBe(-1);
    expect(compareSemver("0.3.0", "0.3.0-rc.1")).toBe(1);
  });

  it("预发布逐段比较：数字段按数值，数字段小于字母段", () => {
    expect(compareSemver("0.3.0-rc.2", "0.3.0-rc.10")).toBe(-1);
    expect(compareSemver("0.3.0-rc.1", "0.3.0-beta.1")).toBe(1);
    expect(compareSemver("0.3.0-alpha", "0.3.0-alpha.1")).toBe(-1);
  });

  it("任一方解析不出时返回 undefined，不抛错", () => {
    expect(compareSemver("0.3.0", "latest")).toBeUndefined();
  });
});

describe("floorOfRange", () => {
  it.each([
    ["0.3.0", "0.3.0"],
    ["^0.3.0", "0.3.0"],
    ["~0.3.0", "0.3.0"],
    [">=0.3.0", "0.3.0"],
    ["=0.3.0", "0.3.0"],
    [">0.3.0", "0.3.0"],
    ["^0.3.0-rc.1", "0.3.0-rc.1"],
    ["  ^0.3.0  ", "0.3.0"],
  ])("区间 %s 的下界是 %s", (range, expected) => {
    expect(floorOfRange(range)).toBe(expected);
  });

  it("无下界的写法返回 undefined", () => {
    expect(floorOfRange("*")).toBeUndefined();
    expect(floorOfRange("")).toBeUndefined();
    expect(floorOfRange("workspace:*")).toBeUndefined();
  });

  it("复合区间取第一段的下界", () => {
    expect(floorOfRange(">=0.3.0 <0.5.0")).toBe("0.3.0");
    expect(floorOfRange("^0.3.0 || ^0.5.0")).toBe("0.3.0");
  });
});

describe("meetsMinimum", () => {
  it("不低于即通过", () => {
    expect(meetsMinimum("0.3.0", "0.3.0")).toBe(true);
    expect(meetsMinimum("0.4.0", "0.3.0")).toBe(true);
    expect(meetsMinimum("1.0.0", "0.3.0")).toBe(true);
  });

  it("低于即不通过", () => {
    expect(meetsMinimum("0.2.0", "0.3.0")).toBe(false);
    expect(meetsMinimum("0.3.0-rc.1", "0.3.0")).toBe(false);
  });

  it("判不了时返回 undefined（与「不达标」区分）", () => {
    expect(meetsMinimum("latest", "0.3.0")).toBeUndefined();
  });
});
