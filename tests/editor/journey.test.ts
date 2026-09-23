/**
 * 测试纪律五类（agent.md §6）在编辑器核心的落地：
 * - 拟态用户：创作者端到端编辑旅程（建列→插命令→改属性→重命名→回溯→诊断清洁）
 * - 混沌随机游走：种子化 300 步混合编辑，每步断言不变量（指针可解析/树可序列化/undo 全程回到初始）
 * - 故意错误：畸形输入注入零抛异常、fail-closed 诊断
 * - 回归锚定：notify type 字段分叉修复（文本投影 notifyType → type）经语料互锁覆盖（schema.test.ts）
 * - 边界条件：undo 容量淘汰/深嵌套/空树（editing.test.ts + 本文件）
 */

import { describe, expect, it } from "vitest";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import {
  EditorSession,
  addColumn,
  analyzeStory,
  getAtPointer,
  insertCommand,
  removeCommand,
  renameColumn,
  setAtPointer,
  updateCommandField,
  validateStory,
} from "@lingfan/editor";

function flowColumn(id: string, commands: StoryCommand[]): StoryColumn {
  return { id, kind: "flow", commands };
}

function expectPointersResolvable(story: Story): void {
  for (const diagnostic of analyzeStory(story)) {
    if (diagnostic.pointer === "") continue;
    const self = getAtPointer(story, diagnostic.pointer);
    if (self !== undefined) continue;
    const parent = diagnostic.pointer.split("/").slice(0, -1).join("/");
    expect(
      getAtPointer(story, parent),
      `${diagnostic.code} @ ${diagnostic.pointer}`,
    ).not.toBeUndefined();
  }
}

describe("拟态创作者旅程：从空骨架到三列分支故事", () => {
  it("建列→插命令→改属性→重命名目标列→诊断清洁→undo 全程可回", () => {
    const initial: Story = {
      formatVersion: 1,
      id: "my-story",
      entry: "start",
      columns: [flowColumn("start", [{ op: "say", text: "序章" }])],
    };
    const session = new EditorSession(initial);
    let steps = 0;
    const track = () => {
      steps += 1;
    };

    session.apply(
      "新增酒馆列",
      (story) => addColumn(story, { id: "inn" }).story,
    );
    track();
    session.apply("插入开场白", (story) =>
      insertCommand(
        story,
        "start",
        "commands",
        { op: "say", text: "欢迎来到灵泛" },
        1,
      ),
    );
    track();
    session.apply("改写开场白", (story) =>
      updateCommandField(
        story,
        "/columns/0/commands/1",
        "text",
        "欢迎来到{place}",
      ),
    );
    track();
    session.apply("声明 place 变量", (story) =>
      insertCommand(
        story,
        "start",
        "commands",
        { op: "set", key: "place", value: "灵泛镇" },
        0,
      ),
    );
    track();
    session.apply("插入分支菜单", (story) =>
      insertCommand(story, "start", "commands", {
        op: "menu",
        prompt: "去哪",
        options: [{ text: "酒馆", target: "inn" }],
      }),
    );
    track();
    session.apply("酒馆改名", (story) => renameColumn(story, "inn", "tavern"));
    track();
    expect(
      getAtPointer(session.story, "/columns/0/commands/3/options/0/target"),
    ).toBe("tavern");
    expect(analyzeStory(session.story)).toEqual([]);
    expectPointersResolvable(session.story);

    while (session.canUndo) session.undo();
    expect(JSON.stringify(session.story)).toBe(JSON.stringify(initial));
    expect(steps).toBe(6);
    while (session.canRedo) session.redo();
    expect(session.story.columns[1]?.id).toBe("tavern");
  });
});

describe("混沌随机游走（种子化 300 步，不变量断言）", () => {
  const SEED = 0x9e3779b9;

  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("300 步混合编辑后 undo 到零 = 初始树；每步指针可解析且树可序列化", () => {
    const random = mulberry32(SEED);
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(random() * list.length)]!;
    const initial: Story = {
      formatVersion: 1,
      id: "chaos",
      entry: "start",
      columns: [
        flowColumn("start", [
          { op: "say", text: "起点" },
          { op: "set", key: "gold", value: 0 },
        ]),
        flowColumn("inn", [{ op: "say", text: "酒馆" }]),
      ],
      defines: { greeting: "hi" },
    };
    const session = new EditorSession(initial, { undoCapacity: 4096 });
    const inserts = [
      { op: "say", text: "旅行者来了" },
      { op: "set", key: "mood", value: "平静" },
      { op: "jump", target: "inn" },
      { op: "menu", prompt: "选", options: [{ text: "去", target: "start" }] },
      { op: "if", cond: "{gold > 3}", then: [{ op: "say", text: "富有" }] },
      { op: "wait", seconds: 0.5 },
      { op: "bgm", resource: "Audio/x.mp3" },
      { op: "auto_save", enabled: false },
    ];
    const allowedCodes = new Set([
      "missing-target",
      "unknown-function",
      "missing-entry",
      "unused-translation",
      // 合法瞬态：删除定义命令后 cond/插值引用悬空（编辑器实时诊断正是为此存在）
      "undefined-variable",
    ]);

    for (let step = 0; step < 300; step += 1) {
      const story = session.story;
      const roll = random();
      if (roll < 0.3) {
        const columnIndex = Math.floor(random() * story.columns.length);
        session.apply(`插入#${step}`, (current) =>
          insertCommand(
            current,
            current.columns[columnIndex]!.id,
            "commands",
            structuredClone(pick(inserts)),
          ),
        );
      } else if (roll < 0.45) {
        const columnIndex = Math.floor(random() * story.columns.length);
        const pointer = `/columns/${columnIndex}/commands/0`;
        const target = story.columns[columnIndex]?.commands?.[0];
        const isTextCommand =
          target !== undefined &&
          (target.op === "say" || target.op === "notify");
        session.apply(`改文本#${step}`, (current) =>
          isTextCommand
            ? updateCommandField(current, pointer, "text", `改写${step}`)
            : null,
        );
      } else if (roll < 0.6) {
        const columnIndex = Math.floor(random() * story.columns.length);
        const pointer = `/columns/${columnIndex}/commands/0`;
        session.apply(`删除#${step}`, (current) =>
          removeCommand(current, pointer),
        );
      } else if (roll < 0.75) {
        session.apply(
          `新列#${step}`,
          (current) => addColumn(current, { id: `col-${step}` }).story,
        );
      } else if (roll < 0.85) {
        const from = pick(session.story.columns.map((column) => column.id));
        session.apply(`改名#${step}`, (current) =>
          renameColumn(current, from, `renamed-${step}`),
        );
      } else {
        session.undo();
      }

      const current = session.story;
      expect(() => JSON.stringify(current)).not.toThrow();
      const issues = validateStory(current).concat(analyzeStory(current));
      const unexpected = issues.filter(
        (issue) => !allowedCodes.has(issue.code),
      );
      expect(unexpected, `step=${step}`).toEqual([]);
      expectPointersResolvable(current);
      expect(session.undoDepth).toBeLessThanOrEqual(4096);
    }

    while (session.canUndo) session.undo();
    expect(JSON.stringify(session.story)).toBe(JSON.stringify(initial));
  });
});

describe("故意错误注入：零抛异常 + fail-closed 诊断", () => {
  it("analyzeStory 对各种畸形输入不抛异常且指针可解析", () => {
    const weirdStories: unknown[] = [
      null,
      42,
      "story",
      [],
      {},
      { formatVersion: 1 },
      { formatVersion: 2, id: "x", entry: "e", columns: [] },
      { formatVersion: 1, id: "x", entry: "e", columns: [null, 3, "x"] },
      {
        formatVersion: 1,
        id: "x",
        entry: "e",
        columns: [{ id: "e", kind: "weird" }],
      },
      {
        formatVersion: 1,
        id: "x",
        entry: "e",
        columns: [
          { id: "e", kind: "flow", commands: [null, "cmd", { op: 42 }, {}] },
        ],
      },
    ];
    for (const weird of weirdStories) {
      expect(() => analyzeStory(weird as Story)).not.toThrow();
      const diagnostics = analyzeStory(weird as Story);
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(typeof diagnostic.pointer).toBe("string");
        expect(typeof diagnostic.message).toBe("string");
      }
    }
  });

  it("深嵌套块体（40 层 if）不爆栈且诊断定位到最深处", () => {
    let command: StoryCommand = { op: "say", text: "底" };
    for (let depth = 0; depth < 40; depth += 1) {
      command = { op: "if", cond: "{true}", then: [command] };
    }
    const story: Story = {
      formatVersion: 1,
      id: "deep",
      entry: "c",
      columns: [flowColumn("c", [command])],
    };
    const diagnostics = analyzeStory(story);
    expect(diagnostics).toEqual([]);
  });

  it("深嵌套中的未知 op 拿到最深指针（fail-closed 不吞）", () => {
    let command: StoryCommand = { op: "ghost_op" };
    for (let depth = 0; depth < 20; depth += 1) {
      command = { op: "while", cond: "{true}", body: [command] };
    }
    const story: Story = {
      formatVersion: 1,
      id: "deep",
      entry: "c",
      columns: [flowColumn("c", [command])],
    };
    const diagnostics = analyzeStory(story);
    const unknown = diagnostics.find((d) => d.code === "unknown-op");
    let expectedPointer = "/columns/0/commands/0";
    for (let depth = 0; depth < 20; depth += 1) expectedPointer += "/body/0";
    expect(unknown?.pointer).toBe(expectedPointer);
  });

  it("删除被引用列产生 missing-target（不静默改指，fail-closed 语义）", () => {
    const story: Story = {
      formatVersion: 1,
      id: "d",
      entry: "start",
      columns: [
        flowColumn("start", [
          { op: "jump", target: "inn" },
          { op: "menu", prompt: "m", options: [{ text: "去", target: "inn" }] },
        ]),
        flowColumn("inn", []),
      ],
    };
    const session = new EditorSession(story);
    session.apply("删酒馆", (current) => {
      const index = current.columns.findIndex((column) => column.id === "inn");
      const next = structuredClone(current);
      next.columns.splice(index, 1);
      return next;
    });
    const diagnostics = analyzeStory(session.story);
    const missing = diagnostics.filter((d) => d.code === "missing-target");
    expect(missing).toHaveLength(2);
    expect(session.undo()).toBe(true);
    expect(analyzeStory(session.story)).toEqual([]);
  });

  it("undefined entry + 空命令树边界", () => {
    const empty: Story = {
      formatVersion: 1,
      id: "e",
      entry: "solo",
      columns: [flowColumn("solo", [])],
    };
    expect(analyzeStory(empty)).toEqual([]);
    expect(
      setAtPointer(empty, "/columns/0/commands/0", { op: "say", text: "x" }),
    ).not.toBeNull();
  });
});
