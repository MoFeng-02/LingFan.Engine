/**
 * 本地化工作台 · 覆盖率判据测试（**边界条件** + **不变量** + **故意错误**）。
 *
 * 重点覆盖两件容易出错的事：
 * ① **`0/0` 不得渲染成 `NaN%` / `100%`**（空态是显式状态，不是"全部译完"）；
 * ② **多译键不进分子**（译文有、原文无的残留键不是"翻译了原文"）。
 */
import { describe, expect, it } from "vitest";
import type { DiagnosticSupply } from "@lingfan-engine/core";
import {
  coverageLabelOf,
  coveragePercentOf,
  coverageStateOf,
  groupKeysByStory,
  langCoverage,
  workbenchOverview,
} from "../../packages/editor/src/i18n/coverage";
// 投影是纯函数（零 vue/零 IO）：直接测供给 → 语言摘要，不装配 composable
import { projectLangSummaries } from "../../apps/editor/src/app/useI18nWorkbench";

describe("单语言覆盖率", () => {
  it("基本比率：交集计入分子，多译键不进分子", () => {
    const c = langCoverage(["a", "b", "c"], "en", ["a", "b", "X", "Y"]);
    expect(c.total).toBe(3);
    expect(c.translated).toBe(2); // X/Y 是多译，不进分子
    expect(c.missing).toEqual(["c"]);
    expect(c.unused).toEqual(["X", "Y"]); // 稳定排序
    expect(c.ratio).toBeCloseTo(2 / 3, 10);
  });

  it("全部译出 ⇒ ratio 1、complete", () => {
    const c = langCoverage(["a", "b"], "en", ["a", "b"]);
    expect(c.ratio).toBe(1);
    expect(coverageStateOf(c)).toBe("complete");
  });

  it("一条未译 ⇒ untranslated", () => {
    const c = langCoverage(["a", "b"], "en", []);
    expect(c.translated).toBe(0);
    expect(coverageStateOf(c)).toBe("untranslated");
  });

  it("**空原文 ⇒ 0/0 判 empty，百分比是「—」不是 100%**", () => {
    const c = langCoverage([], "en", ["残留键"]);
    expect(c.total).toBe(0);
    expect(c.ratio).toBe(0); // 绝不给 NaN
    expect(Number.isNaN(c.ratio)).toBe(false);
    expect(coverageStateOf(c)).toBe("empty");
    expect(coveragePercentOf(c)).toBe("—");
    // 多译仍要报出来（空原文下的残留键是真实问题）
    expect(c.unused).toEqual(["残留键"]);
  });

  it("**空原文 + 空译文** ⇒ empty（不是 complete）", () => {
    const c = langCoverage([], "en", []);
    expect(coverageStateOf(c)).toBe("empty");
    expect(coveragePercentOf(c)).toBe("—");
  });

  it("部分已译 ⇒ partial", () => {
    const c = langCoverage(["a", "b", "c"], "en", ["a"]);
    expect(coverageStateOf(c)).toBe("partial");
  });

  it("缺译/多译键稳定排序（可复现 diff）", () => {
    const c = langCoverage(["z", "a", "m"], "en", ["z", "Y", "A"]);
    expect(c.missing).toEqual(["a", "m"]);
    expect(c.unused).toEqual(["A", "Y"]);
  });

  it("重复键不重复计数（原文重复 ⇒ 分母按出现次数，分子只算已覆盖的）", () => {
    const c = langCoverage(["a", "a", "b"], "en", ["a"]);
    // 分母是数组长度（3），分子按 sources 逐个查 set（2 个 a 都算已译）
    expect(c.total).toBe(3);
    expect(c.translated).toBe(2);
  });
});

describe("三态文案（描述状态，不叙述历史）", () => {
  it("四态各有各的文案", () => {
    expect(coverageLabelOf("empty")).toBe("无可译内容");
    expect(coverageLabelOf("complete")).toBe("已全部译出");
    expect(coverageLabelOf("untranslated")).toBe("尚未开始");
    expect(coverageLabelOf("partial")).toBe("部分已译");
  });

  it("百分比永不出现 NaN/Infinity（多种输入抽样）", () => {
    const cases: Array<[string[], string[]]> = [
      [[], []],
      [[], ["x"]],
      [["a"], []],
      [["a"], ["a"]],
      [["a", "b", "c"], ["a"]],
    ];
    for (const [sources, overlay] of cases) {
      const text = coveragePercentOf(langCoverage(sources, "en", overlay));
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("Infinity");
    }
  });
});

describe("多语言汇总", () => {
  it("按语言码码元序稳定排序", () => {
    const o = workbenchOverview(["a", "b"], {
      zh: ["a"],
      en: ["a", "b"],
      ja: [],
    });
    expect(o.coverages.map((c) => c.lang)).toEqual(["en", "ja", "zh"]);
  });

  it("各语言共用同一分母（原文键总数）", () => {
    const o = workbenchOverview(["a", "b", "c"], { en: ["a"], zh: [] });
    expect(o.totalSources).toBe(3);
    expect(o.coverages.every((c) => c.total === 3)).toBe(true);
  });

  it("多译并集去重且排序", () => {
    const o = workbenchOverview(["a"], { en: ["a", "X"], zh: ["a", "X", "Y"] });
    expect(o.unusedAll).toEqual(["X", "Y"]);
  });

  it("无语言（空对象）⇒ coverages 为空但 totalSources 仍报真实值", () => {
    const o = workbenchOverview(["a", "b"], {});
    expect(o.coverages).toEqual([]);
    expect(o.totalSources).toBe(2);
  });
});

describe("骨架分组（键 = 故事相对路径，不含扩展名）", () => {
  it("保持键序稳定（每个故事的键排序）", () => {
    const g = groupKeysByStory(new Map([["chapter1/tavern", ["z", "a"]]]));
    expect(g.get("chapter1/tavern")).toEqual(["a", "z"]);
  });

  it("平铺工程：键 = 故事 id", () => {
    const g = groupKeysByStory(new Map([["tavern", ["a"]]]));
    expect(g.get("tavern")).toEqual(["a"]);
  });

  it("空输入 ⇒ 空 Map（不抛）", () => {
    expect(groupKeysByStory(new Map()).size).toBe(0);
  });
});

/* ———————————————— 语言摘要 · 供给侧真实文件布局（双轨回落） ———————————————— */

function supplyOf(partial: Partial<DiagnosticSupply>): DiagnosticSupply {
  return {
    resourceFiles: new Set(),
    overlayKeys: new Set(),
    overlayKeysByLang: new Map(),
    ...partial,
  };
}

describe("语言摘要 · 真实每语言文件表（overlayFilesByLang 优先，旧口径回落）", () => {
  it("per-story 布局：逐文件真实路径原样呈现，不再硬猜 main.json", () => {
    const langs = projectLangSummaries(
      supplyOf({
        overlayFilesByLang: new Map([
          [
            "en",
            new Map([
              ["Lang/en/chapter1/start.json", new Set(["世界", "你好"])],
              ["Lang/en/host/main.json", new Set(["宿主键"])],
            ]),
          ],
        ]),
      }),
    );
    expect(langs).toHaveLength(1);
    expect([...langs[0].files.keys()]).toEqual([
      "Lang/en/chapter1/start.json",
      "Lang/en/host/main.json",
    ]);
    expect(langs[0].files.get("Lang/en/chapter1/start.json")).toEqual([
      "世界",
      "你好",
    ]);
  });

  it("single 布局：Lang/{lang}.json 路径原样（不归一成 main.json）", () => {
    const langs = projectLangSummaries(
      supplyOf({
        overlayFilesByLang: new Map([
          ["ja", new Map([["Lang/ja.json", new Set(["你好"])]])],
        ]),
      }),
    );
    expect([...langs[0].files.keys()]).toEqual(["Lang/ja.json"]);
  });

  it("有效零键文件进表（空键集）；语言与文件都稳定排序", () => {
    const langs = projectLangSummaries(
      supplyOf({
        overlayFilesByLang: new Map([
          ["zh", new Map([["Lang/zh/b.json", new Set<string>()]])],
          [
            "en",
            new Map([
              ["Lang/en/z.json", new Set(["b"])],
              ["Lang/en/a.json", new Set(["a"])],
            ]),
          ],
        ]),
      }),
    );
    expect(langs.map((l) => l.lang)).toEqual(["en", "zh"]);
    expect([...langs[0].files.keys()]).toEqual([
      "Lang/en/a.json",
      "Lang/en/z.json",
    ]);
    expect(langs[1].files.get("Lang/zh/b.json")).toEqual([]);
  });

  it("旧口径回落：供给方未升级（无 overlayFilesByLang）⇒ 单文件假设投影", () => {
    const langs = projectLangSummaries(
      supplyOf({
        overlayKeysByLang: new Map([["en", new Set(["世界", "你好"])]]),
      }),
    );
    expect(langs).toHaveLength(1);
    expect([...langs[0].files.keys()]).toEqual(["Lang/en/main.json"]);
    expect(langs[0].files.get("Lang/en/main.json")).toEqual(["世界", "你好"]);
  });

  it("供给缺席（未打开工程）⇒ 空列表，不报错", () => {
    expect(projectLangSummaries(undefined)).toEqual([]);
  });
});
