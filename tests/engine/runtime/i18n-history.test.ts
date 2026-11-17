/**
 * 历史面板派生（快照存原文的配套读口）。
 * - historyView 按每个检查点自身捕获的源 + 当前 overlay 派生 speaker/text/nvlLines
 * - 切语言历史同步生效（每次读取按当前语言重派生，不改快照）
 * - 老快照无源：译文成品原文直出不崩、不误命中（冲突表也不查）
 * I18nPort 为契约替身；老快照由新档检查点手工退化构造（删源键 + 文本替换为译文）。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile, SaveDataV1 } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

/** I18nPort 契约替身：内存译文表 */
class MemoryI18nPort {
  private readonly tables = new Map<string, Record<string, string>>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    return [{ path: "main.json", entries: this.tables.get(lang) ?? {} }];
  }
}

function makeHarness(
  commands: object[],
  port?: MemoryI18nPort,
  defines?: Record<string, unknown>,
) {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands }],
      ...(defines !== undefined ? { defines } : {}),
    }),
    port ? { i18nPort: port } : {},
  );
  return engine;
}

describe("历史面板按当前语言派生", () => {
  it("检查点原文经当前 overlay 派生；切语言历史同步生效", async () => {
    const port = new MemoryI18nPort()
      .table("en", { 甲: "A", 乙: "B" })
      .table("ja", { 甲: "甲J", 乙: "乙J" });
    const engine = makeHarness(
      [
        { op: "say", text: "甲" },
        { op: "say", text: "乙" },
      ],
      port,
    );
    engine.start();
    engine.advance(); // 提交甲检查点
    engine.advance(); // 提交乙检查点
    expect(engine.historyView().map((e) => e.text)).toEqual(["甲", "乙"]);
    await engine.setLanguage("en");
    expect(engine.historyView().map((e) => e.text)).toEqual(["A", "B"]);
    await engine.setLanguage("ja");
    expect(engine.historyView().map((e) => e.text)).toEqual(["甲J", "乙J"]);
    engine.dispose();
  });

  it("插值历史用检查点那一刻捕获的实参重译", async () => {
    const port = new MemoryI18nPort().table("en", {
      "你好 {name}": "Hello {name}",
    });
    const engine = makeHarness(
      [
        { op: "say", text: "你好 {name}" },
        { op: "say", text: "再见" },
      ],
      port,
      { name: "世界" },
    );
    engine.start();
    engine.advance(); // 检查点捕获源 values={name:"世界"}
    await engine.setLanguage("en");
    expect(engine.historyView()[0].text).toBe("Hello 世界");
    engine.dispose();
  });

  it("NVL 历史逐检查点派生：各检查点只见当时累积的行", async () => {
    const port = new MemoryI18nPort().table("en", {
      第一段: "One",
      第二段: "Two",
    });
    const engine = makeHarness(
      [
        { op: "nvl" },
        { op: "say", text: "第一段" },
        { op: "say", text: "第二段" },
      ],
      port,
    );
    await engine.setLanguage("en");
    engine.start();
    engine.advance();
    engine.advance();
    const view = engine.historyView();
    expect(view.map((e) => e.nvl)).toEqual([true, true]);
    expect(view[0].nvlLines).toEqual(["One"]);
    expect(view[1].nvlLines).toEqual(["One", "Two"]);
    engine.dispose();
  });
});

describe("老快照降级：无源检查点原文直出", () => {
  /** 新档退化为老档：档尾状态与每个检查点都删源键、对话文本替换为译文成品 */
  function degradeHistory(save: SaveDataV1): SaveDataV1 {
    const degradeState = (state: [string, unknown][]): [string, unknown][] =>
      state
        .filter(([key]) => key !== SYS.i18nSources)
        .map(([key, value]): [string, unknown] => {
          if (key !== SYS.currentDialogText) return [key, value];
          return [key, value === "甲" ? "A" : "B"];
        });
    return {
      ...save,
      state: degradeState(save.state),
      history: save.history.map((h) => ({
        ...h,
        state: degradeState(h.state),
      })),
    };
  }

  it("老快照译文成品不查表（冲突表也不误命中）；切语言保持原样", async () => {
    const saver = makeHarness([
      { op: "say", text: "甲" },
      { op: "say", text: "乙" },
    ]);
    saver.start();
    saver.advance(); // 甲检查点 + 乙等待 → 存档
    const legacy = degradeHistory(saver.exportSave()!);
    saver.dispose();

    // 冲突表：老快照的译文成品 A/B 恰好也是另一些键的原文
    const port = new MemoryI18nPort()
      .table("en", { 甲: "A", A: "AY", 乙: "B", B: "BE" })
      .table("fr", { 甲: "Ah", 乙: "Bh", A: "AY-fr" });
    const engine = makeHarness(
      [
        { op: "say", text: "甲" },
        { op: "say", text: "乙" },
      ],
      port,
    );
    await engine.setLanguage("en");
    engine.start();
    expect(engine.importSave(legacy)).toBe(true);
    // 等待 op 重放重建原文 + 源 → 正常派生（B 不误命中 BE）
    expect(engine.get(SYS.currentDialogText)).toBe("B");
    // 老检查点无源 → 译文成品直出（A 不误命中 AY）
    expect(engine.historyView()[0].text).toBe("A");
    await engine.setLanguage("fr");
    expect(engine.historyView()[0].text).toBe("A"); // 无源保持原样
    expect(engine.get(SYS.currentDialogText)).toBe("Bh"); // 有源按 fr 派生
    engine.dispose();
  });
});
