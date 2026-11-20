/**
 * NVL 每页行数窗口测试（显示层分页，绝不截断缓冲）。
 *
 * `nvlPageLines` 只决定「这一屏画最近几行」，SYS.nvlBuffer 全量仍在——回溯/历史
 * 读的是缓冲而非这个窗口。五类覆盖：多方位（缺省/合法/非法页容量）、边界（行数恰等
 * 页容量/空缓冲）、不变量（窗口永远是缓冲的后缀，不丢行、不改序）。
 */
import { describe, expect, it } from "vitest";
import { nvlPageLines } from "@lingfan-engine/ui";

const lines = ["一", "二", "三", "四", "五"];

describe("缺省/非法页容量 = 全量（不分页）", () => {
  it("pageSize 缺省 → 全量", () => {
    expect(nvlPageLines(lines, undefined)).toEqual(lines);
  });

  it("非正整数/非数/0/负数 → 全量", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, "3" as unknown as number]) {
      expect(nvlPageLines(lines, bad)).toEqual(lines);
    }
  });
});

describe("合法页容量 = 最近 N 行窗口", () => {
  it("行数超过页容量 → 取最近 N 行（缓冲后缀）", () => {
    expect(nvlPageLines(lines, 2)).toEqual(["四", "五"]);
    expect(nvlPageLines(lines, 3)).toEqual(["三", "四", "五"]);
    expect(nvlPageLines(lines, 1)).toEqual(["五"]);
  });

  it("行数恰等/小于页容量 → 全量", () => {
    expect(nvlPageLines(lines, 5)).toEqual(lines);
    expect(nvlPageLines(lines, 10)).toEqual(lines);
  });

  it("空缓冲 → 空（任何页容量）", () => {
    expect(nvlPageLines([], 3)).toEqual([]);
    expect(nvlPageLines([], undefined)).toEqual([]);
  });
});

describe("不变量：窗口是缓冲后缀，不丢行不改序", () => {
  it("随机缓冲 × 页容量，窗口恒为后缀且长度 ≤ 页容量", () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 100; i += 1) {
      const len = Math.floor(rand() * 30);
      const buf = Array.from({ length: len }, (_, k) => `行${k}`);
      const pageSize = Math.floor(rand() * 12) + 1;
      const win = nvlPageLines(buf, pageSize);
      expect(win.length).toBeLessThanOrEqual(pageSize);
      expect(win.length).toBe(Math.min(buf.length, pageSize));
      // 后缀：窗口逐行等于缓冲尾部
      expect(win).toEqual(buf.slice(buf.length - win.length));
    }
  });
});
