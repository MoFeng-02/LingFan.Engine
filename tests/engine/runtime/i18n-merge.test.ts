/**
 * I18N 合并规划锁定（规范供给序的唯一声明点在 core planOverlayMerge）：
 * - main.json 兜底最先 + 其余按路径字典序（码元比较，不依赖 locale）+ 同键后写胜
 * - 确定性：同一批文件任意读入顺序 ⇒ entries 与 order 都相同
 * - 互锁：同一规范序输入下 planOverlayMerge 与 mergeOverlayFiles 同键同值
 * - 合并表喂引擎查表：规划表逐条翻译与规划一致（CLI↔引擎互锁的 core 侧一半，
 *   编辑器/CLI 侧一半在 editor 测试）
 * I18nPort 为契约替身（按契约 Mock，不 Mock 实现）。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import {
  StoryEngine,
  mergeOverlayFiles,
  planOverlayMerge,
  parseStory,
} from "@lingfan-engine/core";

/** I18nPort 契约替身：按语言供给任意文件列表（含多文件/乱序场景） */
class MemoryI18nPort {
  private readonly supplies = new Map<string, I18nOverlayFile[]>();

  supply(lang: string, files: I18nOverlayFile[]): this {
    this.supplies.set(lang, files);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    return this.supplies.get(lang) ?? [];
  }
}

function makeEngine(port: MemoryI18nPort): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "你好" }] },
      ],
    }),
    { i18nPort: port },
  );
}

/** 共享夹具：main 兜底 + 两个子目录文件，含同键冲突与空串译文 */
const FILES: I18nOverlayFile[] = [
  { path: "ui/b.json", entries: { 攻击: "b-Attack", 防御: "b-Defend" } },
  {
    path: "main.json",
    entries: { 攻击: "main-Attack", 道具: "main-Item", 空串: "main-非空" },
  },
  { path: "ui/a.json", entries: { 防御: "a-Defend", 空串: "" } },
];

/** 规范序：main.json 最先，其余按路径字典序 */
const CANONICAL: I18nOverlayFile[] = [FILES[1], FILES[2], FILES[0]];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

describe("planOverlayMerge · 规范供给序", () => {
  it("main.json 最先兜底（即使最后供给），其余按路径字典序；order 即规范序", () => {
    const plan = planOverlayMerge(FILES);
    expect(plan.order).toEqual(["main.json", "ui/a.json", "ui/b.json"]);
    expect(plan.entries.get("攻击")).toBe("b-Attack"); // 非 main 覆盖 main，字典序后者胜
    expect(plan.entries.get("防御")).toBe("b-Defend");
    expect(plan.entries.get("道具")).toBe("main-Item"); // main 兜底
  });

  it("字典序按码元比较（Z < a），不依赖 locale 排序", () => {
    const plan = planOverlayMerge([
      { path: "a.json", entries: { k: "a" } },
      { path: "Z.json", entries: { k: "Z" } },
    ]);
    expect(plan.order).toEqual(["Z.json", "a.json"]);
    expect(plan.entries.get("k")).toBe("a"); // a.json 字典序在后 ⇒ 后写胜
  });

  it("空串译文也是命中：覆盖 main 的非空兜底", () => {
    const plan = planOverlayMerge(FILES);
    expect(plan.entries.get("空串")).toBe("");
    expect(plan.entries.has("空串")).toBe(true);
  });

  it("空供给 ⇒ 空表空序；无 main.json ⇒ 全部按字典序", () => {
    const empty = planOverlayMerge([]);
    expect(empty.entries.size).toBe(0);
    expect(empty.order).toEqual([]);
    const plan = planOverlayMerge([
      { path: "b.json", entries: { k: "b" } },
      { path: "a.json", entries: { k: "a" } },
    ]);
    expect(plan.order).toEqual(["a.json", "b.json"]);
    expect(plan.entries.get("k")).toBe("b");
  });

  it("确定性：同一批文件的全部读入排列 ⇒ entries 与 order 完全相同", () => {
    const baseline = planOverlayMerge(FILES);
    for (const shuffled of permutations(FILES)) {
      const plan = planOverlayMerge(shuffled);
      expect(plan.order).toEqual(baseline.order);
      expect([...plan.entries]).toEqual([...baseline.entries]);
    }
  });

  it("不改调用方数组：规划只排序副本，供给数组保持原顺序", () => {
    const files = [...FILES];
    planOverlayMerge(files);
    expect(files.map((f) => f.path)).toEqual(FILES.map((f) => f.path));
  });
});

describe("互锁 · planOverlayMerge ≡ mergeOverlayFiles（同键同值）", () => {
  it("规范序输入：两者产出同键同值", () => {
    const plan = planOverlayMerge(CANONICAL);
    const merged = mergeOverlayFiles(CANONICAL);
    expect([...plan.entries]).toEqual([...merged]);
  });

  it("任意序输入：规划结果 ≡ 规范序直接合并（含空串键）", () => {
    const merged = mergeOverlayFiles(CANONICAL);
    for (const shuffled of permutations(FILES)) {
      const plan = planOverlayMerge(shuffled);
      expect([...plan.entries]).toEqual([...merged]);
    }
    expect(merged.get("空串")).toBe("");
  });
});

describe("合并表喂引擎查表（CLI↔引擎互锁的 core 侧一半）", () => {
  it("规划表拍平喂端口 ⇒ engine.translate 逐条与规划一致，未命中回退原文", async () => {
    const plan = planOverlayMerge(FILES);
    const port = new MemoryI18nPort().supply("en", [
      { path: "main.json", entries: Object.fromEntries(plan.entries) },
    ]);
    const engine = makeEngine(port);
    engine.start();
    await engine.setLanguage("en");
    for (const [original, translation] of plan.entries) {
      expect(engine.translate(original)).toBe(translation);
    }
    expect(engine.translate("未收录")).toBe("未收录");
    engine.dispose();
  });

  it("规范序多文件供给 ⇒ 引擎整表与规划一致（供给序即覆盖序在规范序下重合）", async () => {
    const plan = planOverlayMerge(FILES);
    const port = new MemoryI18nPort().supply("en", CANONICAL);
    const engine = makeEngine(port);
    engine.start();
    await engine.setLanguage("en");
    for (const [original, translation] of plan.entries) {
      expect(engine.translate(original)).toBe(translation);
    }
    engine.dispose();
  });
});
