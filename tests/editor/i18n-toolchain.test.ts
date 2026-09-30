/**
 * i18n 工具链测试。
 *
 * 测试纪律：
 * - **抽取 ≡ 诊断 ≡ 运行期三方互锁**：extractStoryKeys 与 indexStory.originals 同表
 *   （TRANSLATE_SURFACES 单一事实源）逐集合相等；再用**真引擎旅程**（哨兵译文表）证明
 *   「引擎真查的键 = 抽取器输出」——新增挂接点没跟上抽取器 → 运行期哨兵缺失立刻红；
 * - **源码绊线**：engine.ts 的 `this.translate(...)` 实参形态全集合锁定，引擎侧新增
 *   挂接点而面表未同步时红（提示改 TRANSLATE_SURFACES，抽取器/诊断自动跟随）；
 * - **骨架往返**：planOverlaySkeleton 喂回 mergeOverlayFiles → 键集合与抽取输出
 *   双向一致（无缺、无多）；增量模式既有译文（含空串）绝不覆盖；
 * - **对账三态**：缺译 / 多译 / 齐各一 + 按语言分组 + 可读报告。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan/engine";
import {
  SYS,
  StoryEngine,
  mergeOverlayFiles,
  parseStory,
} from "@lingfan/engine";
import {
  analyzeStory,
  extractStoryKeys,
  formatTranslationReport,
  indexStory,
  planOverlaySkeleton,
  reconcileTranslations,
} from "@lingfan/editor";
import engineSource from "../../packages/engine/src/runtime/engine.ts?raw";

/* ———————————————— 原文键抽取器 ———————————————— */

function fixtureStory(): ReturnType<typeof parseStory> {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "start",
    defines: { gold: 5 }, // defines 不是翻译面（负例）
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "character", id: "hero", screen: "冒险者" },
          { op: "notify", text: "获得道具" },
          { op: "say", text: "你好", speaker: "少女" },
          {
            op: "menu",
            prompt: "选择行动",
            options: [{ text: "攻击", target: "scene" }],
          },
          { op: "input", prompt: "你的名字", store: "name" },
          { op: "if", cond: "{gold > 3}", then: [{ op: "say", text: "富有" }] },
        ],
      },
      {
        id: "scene",
        kind: "scene",
        elements: [
          { type: "text", text: "标题" },
          {
            type: "vbox",
            children: [
              { type: "text", text: "嵌套" },
              { type: "image", src: "Images/x.png" }, // 非文字属性不入集
            ],
          },
        ],
        entry: [{ op: "say", text: "入口句" }],
      },
      { id: "spare", kind: "flow", commands: [{ op: "say", text: "你好" }] }, // 跨列重复 → 去重
    ],
  });
}

describe("抽取器：与诊断 originals 同集合（结构互锁）", () => {
  it("全表面覆盖（say×2 / menu×2 / input / notify / character.screen / 元素 text 含嵌套）", () => {
    const story = fixtureStory();
    const keys = extractStoryKeys(story);
    const expected = [
      "你好", // 跨列重复 → 去重
      "你的名字",
      "入口句",
      "冒险者",
      "嵌套",
      "富有",
      "少女",
      "攻击",
      "标题",
      "获得道具",
      "选择行动",
    ];
    expect(keys).toHaveLength(11);
    expect(keys).toEqual([...expected].sort()); // 稳定排序（码元序）
    expect(keys).not.toContain("gold"); // defines 不入集
  });

  it("extractStoryKeys(story) 的集合 ≡ indexStory(story).originals（同表互锁）", () => {
    const story = fixtureStory();
    const extracted = new Set(extractStoryKeys(story));
    const originals = indexStory(story).originals;
    expect(extracted.size).toBe(originals.size);
    for (const key of originals) expect(extracted.has(key), key).toBe(true);
  });

  it("空串与非字符串面值不入集（原始对象口径——parseStory 会拒收，诊断/抽取面不经过它）", () => {
    const raw = {
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        {
          id: "a",
          kind: "flow",
          commands: [
            { op: "say", text: "" },
            { op: "say", text: 42 },
            { op: "say", text: "真句" },
          ],
        },
      ],
    } as never;
    expect(extractStoryKeys(raw)).toEqual(["真句"]);
    expect([...indexStory(raw).originals]).toEqual(["真句"]);
  });

  it("畸形输入 fail-closed 返回空数组（与 indexStory 同口径）", () => {
    for (const weird of [null, undefined, {}, { columns: "x" }]) {
      expect(extractStoryKeys(weird as never)).toEqual([]);
      expect(indexStory(weird as never).originals.size).toBe(0);
    }
  });
});

describe("抽取器：运行期真值互锁（真引擎 + 哨兵译文表）", () => {
  /** I18nPort 契约替身（与 tests/engine/runtime/i18n.test.ts 同构） */
  class MemoryI18nPort {
    readonly calls: string[] = [];
    private readonly entries: Record<string, string>;
    constructor(entries: Record<string, string>) {
      this.entries = entries;
    }
    async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
      this.calls.push(lang);
      return [{ path: "main.json", entries: this.entries }];
    }
  }

  it("引擎真查的键 ≡ 抽取器输出：哨兵全包裹（无遗漏）且无多收（无旁路原文）", async () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        {
          id: "a",
          kind: "flow",
          commands: [
            { op: "notify", text: "获得道具" },
            { op: "say", text: "你好", speaker: "少女" },
            {
              op: "menu",
              prompt: "选择行动",
              options: [
                { text: "攻击", target: "b" },
                { text: "逃跑", target: "b" },
              ],
            },
          ],
        },
        {
          id: "b",
          kind: "scene",
          elements: [
            { type: "text", text: "标题" },
            { type: "vbox", children: [{ type: "text", text: "嵌套" }] },
          ],
          entry: [
            { op: "input", prompt: "你的名字", store: "name" },
            { op: "say", text: "再见" },
          ],
        },
      ],
    });
    const keys = extractStoryKeys(story);
    expect(keys).toHaveLength(10); // 全表面逐一入集（缺一处哨兵即红）

    const engine = new StoryEngine(
      story,
      {
        i18nPort: new MemoryI18nPort(
          Object.fromEntries(keys.map((key) => [key, `⟦${key}⟧`])),
        ),
      },
    );
    const errors: string[] = [];
    const notes: string[] = [];
    const off = engine.onEvent((e) => {
      if (e.payload.kind === "engine.error") errors.push(e.payload.code);
      if (e.payload.kind === "notify") notes.push(e.payload.text);
    });
    const observed = new Set<string>();
    const take = (value: unknown): void => {
      if (typeof value === "string" && value !== "") observed.add(value);
    };

    await engine.setLanguage("en");
    engine.start(); // notify 出站 + say 等待
    take(engine.get(SYS.currentDialogText)); // 你好
    take(engine.get(SYS.currentDialogSpeaker)); // 少女
    notes.forEach((n) => observed.add(n)); // 获得道具
    engine.advance(); // menu 等待
    take(engine.get(SYS.menuPrompt)); // 选择行动
    for (const option of engine.get(SYS.menuOptions) as string[]) {
      take(option); // 攻击 / 逃跑（execMenu 对全部选项即时翻译）
    }
    engine.choose("b"); // 进 scene 列：元素装载（标题/嵌套）+ entry input 等待
    take(engine.get(SYS.inputPrompt)); // 你的名字
    const elements = engine.get(SYS.elements) as {
      props: { text?: unknown };
      children?: { props: { text?: unknown } }[];
    }[];
    for (const element of elements ?? []) {
      take(element.props.text);
      for (const child of element.children ?? []) take(child.props.text);
    }
    engine.input("灵泛"); // 解除输入 → entry say 再见等待
    take(engine.get(SYS.currentDialogText)); // 再见

    expect(errors).toEqual([]); // 驱动本身零错（等待序列正确）
    const unwrapped: string[] = [];
    for (const value of observed) {
      const m = /^⟦(.+)⟧$/s.exec(value);
      expect(m, `观测值未走译文表（哨兵缺失 = 抽取器漏面）：${value}`).not.toBeNull();
      unwrapped.push(m![1]!);
    }
    // 双向：无遗漏（每个抽取键都被真查）+ 无多收（引擎查的都在抽取输出里）
    expect(new Set(unwrapped)).toEqual(new Set(keys));
    off();
    engine.dispose();
  });
});

describe("源码绊线：engine.ts 的 translate 挂接点 ↔ 面表同口径", () => {
  it("translate 实参形态全集合锁定（引擎新增挂接点而面表未同步 → 红）", () => {
    const args = new Set(
      [...engineSource.matchAll(/this\.translate\(([^)]*)\)/g)].map((m) =>
        m[1]!.replace(/\s+as string$/, "").trim(),
      ),
    );
    // 逐一对应：cmd.text → say/notify.text；cmd.prompt → menu/input.prompt；
    // o.text → menu.options[].text；speakerText → say.speaker / character.screen
    // 的运行期解析产物；raw → 元素 text（translateElements，不表面表、走元素遍历）。
    expect([...args].sort()).toEqual([
      "cmd.prompt",
      "cmd.text",
      "o.text",
      "raw",
      "speakerText",
    ]);
  });
});

/* ———————————————— overlay 骨架生成 ———————————————— */

describe("骨架生成", () => {
  const storyKeys = new Map([
    ["start", ["你好", "世界"]],
    ["inn", ["你好", "独有"]],
  ]);

  it("三布局路径正确（single / main / per-story）", () => {
    expect(
      planOverlaySkeleton({ lang: "en", layout: "single", storyKeys })[0]?.path,
    ).toBe("Lang/en.json");
    expect(
      planOverlaySkeleton({ lang: "en", layout: "main", storyKeys })[0]?.path,
    ).toBe("Lang/en/main.json");
    expect(
      planOverlaySkeleton({ lang: "en", layout: "per-story", storyKeys }).map(
        (f) => f.path,
      ),
    ).toEqual(["Lang/en/start.json", "Lang/en/inn.json"]); // Map 插入序
  });

  it("per-story 镜像 Stories/ 递归目录（章节子目录，与旧版引擎对齐）", () => {
    const nested = new Map([
      ["title/title_main", ["开始"]],
      ["chapter1/tavern", ["炉火"]],
    ]);
    expect(
      planOverlaySkeleton({
        lang: "zh-CN",
        layout: "per-story",
        storyKeys: nested,
      }).map((f) => f.path),
    ).toEqual([
      "Lang/zh-CN/title/title_main.json",
      "Lang/zh-CN/chapter1/tavern.json",
    ]);
  });

  it("内容 = 合法 JSON；键与抽取并集一致（无缺无多）；同输入逐字节确定", () => {
    const file = planOverlaySkeleton({ lang: "en", layout: "main", storyKeys })[0]!;
    expect(JSON.parse(file.content)).toEqual(file.entries);
    expect(Object.keys(file.entries)).toEqual(["你好", "独有", "世界"].sort());
    const again = planOverlaySkeleton({ lang: "en", layout: "main", storyKeys })[0]!;
    expect(again.content).toBe(file.content);
    expect(file.content.endsWith("\n")).toBe(true);
  });

  it("增量模式：既有译文（含空串 = 命中语义）保留，缺键补占位", () => {
    const existing = new Map([["Lang/en/main.json", { 你好: "Hello", 世界: "" }]]);
    const file = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: new Map([["start", ["你好", "世界", "新句"]]]),
      existing,
    })[0]!;
    expect(file.entries).toEqual({ 你好: "Hello", 世界: "", 新句: "新句" });
    const blanks = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: new Map([["start", ["你好"]]]),
      placeholder: "empty",
    })[0]!;
    expect(blanks.entries).toEqual({ 你好: "" });
  });

  it("往返互锁：骨架喂回 mergeOverlayFiles → 键集合与抽取并集双向一致", () => {
    const union = new Set(["你好", "世界", "独有"]);
    for (const layout of ["single", "main", "per-story"] as const) {
      const files = planOverlaySkeleton({ lang: "en", layout, storyKeys }).map(
        (f) => ({
          // 运行期供给路径相对 Lang/{lang}/（single 形态 Rust 归一为 main.json）
          path:
            layout === "single"
              ? "main.json"
              : f.path.replace("Lang/en/", ""),
          entries: f.entries,
        }),
      );
      const merged = mergeOverlayFiles(files);
      expect(new Set(merged.keys()), layout).toEqual(union);
    }
  });

  it("往返互锁（嵌套目录）：per-story 镜像章节子目录后合并语义不变", () => {
    const nested = new Map([
      ["chapter1/tavern", ["炉火", "共有"]],
      ["chapter1/cellar", ["木桶", "共有"]],
    ]);
    const files = planOverlaySkeleton({
      lang: "en",
      layout: "per-story",
      storyKeys: nested,
    }).map((f) => ({ path: f.path.replace("Lang/en/", ""), entries: f.entries }));
    const merged = mergeOverlayFiles(files);
    expect(new Set(merged.keys())).toEqual(new Set(["炉火", "木桶", "共有"]));
  });

  it("fail-closed：lang / 故事路径不合法即抛（骨架路径不越界，含段级校验）", () => {
    expect(() =>
      planOverlaySkeleton({ lang: "../x", layout: "main", storyKeys }),
    ).toThrow();
    expect(() =>
      planOverlaySkeleton({ lang: "", layout: "main", storyKeys }),
    ).toThrow();
    // 多段路径在新口径下合法（递归目录镜像）——旧「单段 id」限制已解除
    expect(
      planOverlaySkeleton({
        lang: "en",
        layout: "per-story",
        storyKeys: new Map([["a/b", ["键"]]]),
      })[0]?.path,
    ).toBe("Lang/en/a/b.json");
    // 递归目录的段级校验：`..` / 空段 / 点段逐段拒
    expect(() =>
      planOverlaySkeleton({
        lang: "en",
        layout: "per-story",
        storyKeys: new Map([["chapter1/../evil", ["键"]]]),
      }),
    ).toThrow();
    expect(() =>
      planOverlaySkeleton({
        lang: "en",
        layout: "per-story",
        storyKeys: new Map([["/abs", ["键"]]]),
      }),
    ).toThrow();
    expect(() =>
      planOverlaySkeleton({
        lang: "en",
        layout: "per-story",
        storyKeys: new Map([["chapter1//tavern", ["键"]]]),
      }),
    ).toThrow();
  });
});

/* ———————————————— 缺译 / 多译对账 ———————————————— */

describe("对账", () => {
  it("三态用例：缺译 / 多译 / 齐", () => {
    const sources = ["甲", "乙", "丙"];
    const missing = reconcileTranslations(sources, { en: ["甲", "乙"] });
    expect(missing.missingByLang.get("en")).toEqual(["丙"]);
    expect(missing.unused).toEqual([]);
    const unused = reconcileTranslations(sources, {
      en: ["甲", "乙", "丙", "死键"],
    });
    expect(unused.missingByLang.get("en")).toEqual([]);
    expect(unused.unused).toEqual(["死键"]);
    const even = reconcileTranslations(sources, { en: sources });
    expect(even.missingByLang.get("en")).toEqual([]);
    expect(even.unused).toEqual([]);
  });

  it("按语言分组：各语言独立缺译；多译跨语言并集去重", () => {
    const report = reconcileTranslations(["甲", "乙"], {
      en: ["甲"],
      ja: ["甲", "乙", "Ghost"],
    });
    expect(report.missingByLang.get("en")).toEqual(["乙"]);
    expect(report.missingByLang.get("ja")).toEqual([]);
    expect(report.unused).toEqual(["Ghost"]);
  });

  it("报告文本可读（逐语言计数 + 键列表 + 多译节）", () => {
    const text = formatTranslationReport(
      reconcileTranslations(["甲", "乙"], {
        en: ["甲", "死键"],
        ja: ["甲", "乙"],
      }),
    );
    expect(text).toContain("[en] 缺译 1 条（运行期回退原文）：");
    expect(text).toContain("  - 乙");
    expect(text).toContain("[ja] 缺译 0 条（覆盖完整）");
    expect(text).toContain("多译 1 条（未使用 = 冗余）：");
    expect(text).toContain("  - 死键");
  });
});

/* ———————————————— 缺译诊断（编辑器面板一节） ———————————————— */

describe("缺译诊断：originals − overlay 并集（与 unused-translation 对称）", () => {
  const mini = () =>
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands: [{ op: "say", text: "甲" }, { op: "say", text: "乙" }] }],
    });

  it("overlay 非空：未覆盖原文报 warning（提醒级，不拦保存）", () => {
    const diagnostics = analyzeStory(mini(), {
      overlayKeys: new Set(["甲"]),
    });
    const missing = diagnostics.filter((d) => d.code === "missing-translation");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.severity).toBe("warning");
    expect(missing[0]?.message).toContain("乙");
  });

  it("overlay 空 = 未启用 i18n：不报（原文直出是常态，不制造全量噪声）", () => {
    expect(
      analyzeStory(mini(), { overlayKeys: new Set<string>() }).some(
        (d) => d.code === "missing-translation",
      ),
    ).toBe(false);
    expect(
      analyzeStory(mini()).some((d) => d.code === "missing-translation"),
    ).toBe(false); // 未接供给同样不误报
  });

  it("全覆盖：缺译零报；unused 与 missing 同时各司其职", () => {
    const diagnostics = analyzeStory(mini(), {
      overlayKeys: new Set(["甲", "乙", "孤儿键"]),
    });
    expect(diagnostics.filter((d) => d.code === "missing-translation")).toEqual(
      [],
    );
    expect(
      diagnostics.filter((d) => d.code === "unused-translation"),
    ).toHaveLength(1);
  });
});
