/**
 * 阅读节奏纯函数契约：词元怎么数、停留时长怎么由句长与阅读速度算出来。
 *
 * 这一组是「自动播放每句停多久」的唯一判据来源，打字机与节奏循环都只消费它。
 * 数词元的规则直接决定体感，故逐条锁死：中日韩逐字、拉丁与数字连续串算一个、
 * 空白与标点不算、内联标记不算。
 */
import { describe, expect, it } from "vitest";
import { autoDwellMs, countReadingTokens } from "@lingfan-engine/ui";

describe("countReadingTokens：词元计数口径", () => {
  it("中日韩字符逐字各计一个", () => {
    expect(countReadingTokens("灵泛")).toBe(2);
    expect(countReadingTokens("夜风穿过长廊")).toBe(6);
    expect(countReadingTokens("こんにちは")).toBe(5);
    expect(countReadingTokens("안녕하세요")).toBe(5);
  });

  it("拉丁与数字的连续串算一个词元", () => {
    expect(countReadingTokens("hello")).toBe(1);
    expect(countReadingTokens("hello world")).toBe(2);
    expect(countReadingTokens("LingFan Engine")).toBe(2);
    expect(countReadingTokens("2026")).toBe(1);
    expect(countReadingTokens("第 3 章")).toBe(3);
  });

  it("空白与标点不计", () => {
    expect(countReadingTokens("，。！？…——")).toBe(0);
    expect(countReadingTokens("  \n\t ")).toBe(0);
    expect(countReadingTokens("嗯。")).toBe(1);
  });

  it("内联标记不计（{p} 停顿、{color=…} 样式、{fast}）", () => {
    expect(countReadingTokens("{p}嗯。")).toBe(1);
    expect(countReadingTokens("{color=#f00}灵泛{w}")).toBe(2);
    expect(countReadingTokens("{fast}灵泛")).toBe(2);
    // 标记内部的可见字面（换行符等）同样不参与计数
    expect(countReadingTokens("{br}")).toBe(0);
  });

  it("中英混排按各自规则累加", () => {
    // 「灵泛」2 + 「Engine」1 + 「你好」2
    expect(countReadingTokens("灵泛 Engine 你好")).toBe(5);
  });

  it("空串与纯标记串为 0", () => {
    expect(countReadingTokens("")).toBe(0);
    expect(countReadingTokens("{p}")).toBe(0);
  });
});

describe("autoDwellMs：停留时长", () => {
  it("停留 = 基础停留 + 词元量 / 阅读速度", () => {
    // 12 cps、120 词元 = 10 秒阅读时间，加 1500ms 基础停留
    expect(autoDwellMs({ tokens: 120, readCps: 12, baseMs: 1500 })).toBe(11500);
    expect(autoDwellMs({ tokens: 0, readCps: 12, baseMs: 1500 })).toBe(1500);
  });

  it("句越长停得越久、速度越快停得越短（两条单调性）", () => {
    const short = autoDwellMs({ tokens: 4, readCps: 12, baseMs: 1500 });
    const long = autoDwellMs({ tokens: 40, readCps: 12, baseMs: 1500 });
    expect(long).toBeGreaterThan(short);

    const slow = autoDwellMs({ tokens: 40, readCps: 12, baseMs: 1500 });
    const fast = autoDwellMs({ tokens: 40, readCps: 60, baseMs: 1500 });
    expect(slow).toBeGreaterThan(fast);
  });

  it("阅读速度为 0 或非法时兜底，不产生无穷停留", () => {
    expect(
      Number.isFinite(autoDwellMs({ tokens: 10, readCps: 0, baseMs: 1500 })),
    ).toBe(true);
    expect(autoDwellMs({ tokens: 10, readCps: 0, baseMs: 1500 })).toBe(11500);
    expect(autoDwellMs({ tokens: 10, readCps: Number.NaN, baseMs: 1500 })).toBe(
      11500,
    );
    expect(autoDwellMs({ tokens: 10, readCps: -5, baseMs: 1500 })).toBe(11500);
  });

  it("词元量为负或非法时按 0 处理", () => {
    expect(autoDwellMs({ tokens: -10, readCps: 12, baseMs: 1500 })).toBe(1500);
    expect(autoDwellMs({ tokens: Number.NaN, readCps: 12, baseMs: 1500 })).toBe(
      1500,
    );
  });

  it("基础停留为 0 时只剩阅读时间", () => {
    expect(autoDwellMs({ tokens: 12, readCps: 12, baseMs: 0 })).toBe(1000);
  });
});
