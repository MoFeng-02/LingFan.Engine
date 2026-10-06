/**
 * 覆盖率**字数加权**判据测试（2026-10-05，任务 #18）。
 *
 * 🔴 为何要加权：条数比把「一句长台词」与「一个两字词」同等看待，
 * 而译者体感是**长句没翻更显眼**。真实工程 146 条诊断里 86 条「未使用的译文键」多为短词
 * ⇒ 条数比会**高估**完成度。
 *
 * ⚠️ 权重取**原文长度**（不取译文长度）：i18n 体系里**键 = 原文**，无需值即可算；
 * 且「这句原话多重要」只与原话长短有关。用译文长度会奖励「译得啰嗦」——语义错（见反面用例）。
 */
import { describe, expect, it } from "vitest";
import {
  coveragePercentOf,
  coverageWeightedPercentOf,
  langCoverage,
  workbenchOverview,
} from "../../packages/editor/src/i18n";

describe("覆盖率字数加权 · 核心：**加权 ≠ 条数**", () => {
  it("🔴 只译短句 ⇒ 条数 50%，**加权远低于它**（长句未译被如实反映）", () => {
    const sources = ["短", "这是一个很长的句子需要很多字符"];
    const c = langCoverage(sources, "en", ["短"]);
    expect(c.total).toBe(2);
    expect(c.translated).toBe(1);
    expect(c.ratio).toBeCloseTo(0.5, 5);
    // 1/(1+14) ≈ 0.067 —— 与 0.5 差一个量级：这正是「短词翻完跳一大截」的纠正
    expect(c.weightedRatio).toBeCloseTo(1 / 16, 5);
    expect(c.totalChars).toBe(16);
    expect(c.translatedChars).toBe(1);
  });

  it("🔴 只译长句 ⇒ 加权**高于**条数", () => {
    const sources = ["短", "这是一个很长的句子需要很多字符"];
    const c = langCoverage(sources, "en", ["这是一个很长的句子需要很多字符"]);
    expect(c.ratio).toBeCloseTo(0.5, 5);
    expect(c.weightedRatio).toBeCloseTo(15 / 16, 5);
  });

  it("**百分比文本也分两种口径**（UI 主显示加权、tooltip 给条数）", () => {
    const c = langCoverage(["短", "这是一个很长的句子需要很多字符"], "en", ["短"]);
    expect(coveragePercentOf(c)).toBe("50%");
    expect(coverageWeightedPercentOf(c)).toBe("6%"); // 1/15 = 6.67 → 7
  });
});

describe("覆盖率字数加权 · 边界", () => {
  it("🔴 **码点计**：emoji 不因代理对算 2", () => {
    const c = langCoverage(["🎮"], "en", []);
    expect(c.totalChars).toBe(1); // `String.length` 会给 2
  });

  it("空态：**条数为 0 与字符数为 0 都给「—」**（不裸显示 0%）", () => {
    const empty = langCoverage([], "en", []);
    expect(empty.weightedRatio).toBe(0);
    expect(coverageWeightedPercentOf(empty)).toBe("—");
    expect(coveragePercentOf(empty)).toBe("—");
  });

  it("全译 ⇒ 100%（两种口径一致）", () => {
    const c = langCoverage(["甲", "乙丙"], "en", ["甲", "乙丙"]);
    expect(c.weightedRatio).toBe(1);
    expect(coveragePercentOf(c)).toBe("100%");
    expect(coverageWeightedPercentOf(c)).toBe("100%");
  });

  it("一条都没译 ⇒ 0%", () => {
    const c = langCoverage(["甲", "乙"], "en", []);
    expect(c.weightedRatio).toBe(0);
    expect(coverageWeightedPercentOf(c)).toBe("0%");
  });

  it("**多译键不计入分子也**不计入分母（残留不是「翻译了原文」）", () => {
    const c = langCoverage(["甲"], "en", ["甲", "幽灵键很长很长很长很长"]);
    expect(c.totalChars).toBe(1); // 分母只含原文
    expect(c.weightedRatio).toBe(1);
    expect(c.unused).toEqual(["幽灵键很长很长很长很长"]);
  });
});

describe("覆盖率字数加权 · 汇总", () => {
  it("**原文总字符数是各语言共用的分母**（与译本无关）", () => {
    const o = workbenchOverview(["短", "这是一个很长的句子需要很多字符"], {
      en: ["短"],
      ja: [],
    });
    expect(o.totalSources).toBe(2);
    expect(o.totalSourceChars).toBe(16);
    // 两种语言的分母相同
    const [en, ja] = o.coverages;
    expect(en?.totalChars).toBe(ja?.totalChars);
  });

  it("语言按码元序（稳定）", () => {
    const o = workbenchOverview(["甲"], { zh: [], en: [], ja: [] });
    expect(o.coverages.map((c) => c.lang)).toEqual(["en", "ja", "zh"]);
  });
});
