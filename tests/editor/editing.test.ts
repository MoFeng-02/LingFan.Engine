/**
 * 纯映射器测试（D1）：指针原语不可变性 + 列操作 + renameColumn 引用同步 +
 * EditorSession 统一 undo（一次提交 = 一个单元、跨视图同步、redo 分支清尾）。
 * 锚点: editor-is-pure-mapper / unified-undo-across-views
 */

import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import {
  EditorSession,
  addColumn,
  getAtPointer,
  insertCommand,
  insertAtPointer,
  moveAtPointer,
  moveCommand,
  removeAtPointer,
  removeColumn,
  renameColumn,
  setAtPointer,
  updateCommandField,
} from "@lingfan/editor";

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

const sample: Story = {
  formatVersion: 1,
  id: "demo",
  entry: "start",
  columns: [
    {
      id: "start",
      kind: "flow",
      commands: [
        { op: "say", text: "第一句" },
        { op: "jump", target: "inn" },
      ],
    },
    { id: "inn", kind: "flow", commands: [{ op: "say", text: "酒馆" }] },
  ],
};

describe("指针原语（不可变 + fail-closed）", () => {
  it("setAtPointer 沿路径克隆，原树零改动、未命中路径返回 null", () => {
    const before = snapshot(sample);
    const next = setAtPointer(sample, "/columns/0/commands/0/text", "改了");
    expect(next).not.toBeNull();
    expect(snapshot(sample)).toBe(before);
    expect(getAtPointer(next, "/columns/0/commands/0/text")).toBe("改了");
    expect(getAtPointer(sample, "/columns/0/commands/0/text")).toBe("第一句");
    expect(getAtPointer(next, "/columns/1")).toBe(sample.columns[1]);
    expect(setAtPointer(sample, "/columns/99/id", "x")).toBeNull();
    expect(setAtPointer(sample, "", "x")).toBeNull();
    expect(setAtPointer(sample, "/nope/deep", "x")).toBeNull();
  });

  it("removeAtPointer：数组按索引删、对象删键、越界 null", () => {
    const next = removeAtPointer(sample, "/columns/0/commands/1");
    expect(next?.columns[0]?.commands).toHaveLength(1);
    const dropped = removeAtPointer(next, "/columns/0/commands/0/text");
    expect(dropped?.columns[0]?.commands?.[0]).toEqual({ op: "say" });
    expect(removeAtPointer(sample, "/columns/0/commands/99")).toBeNull();
  });

  it("insertAtPointer / moveAtPointer：插入与重排", () => {
    const inserted = insertAtPointer(sample, "/columns/0/commands", 1, {
      op: "wait",
      seconds: 1,
    });
    expect(inserted?.columns[0]?.commands).toHaveLength(3);
    expect(getAtPointer(inserted, "/columns/0/commands/1")).toEqual({
      op: "wait",
      seconds: 1,
    });
    const moved = moveAtPointer(sample, "/columns/0/commands/1", 0);
    expect(getAtPointer(moved, "/columns/0/commands/0")).toEqual({
      op: "jump",
      target: "inn",
    });
    expect(moveAtPointer(sample, "/columns/0/commands/1", 5)).toBeNull();
    expect(insertAtPointer(sample, "/columns/0/commands", 9, {})).toBeNull();
  });

  it("指针转义：含 ~ 与 / 的键（RFC 6901）", () => {
    const story: Story = {
      ...sample,
      defines: { "a~b/c": 1 },
    };
    expect(getAtPointer(story, "/defines/a~0b~1c")).toBe(1);
    const next = setAtPointer(story, "/defines/a~0b~1c", 2);
    expect(next?.defines?.["a~b/c"]).toBe(2);
  });
});

describe("列操作", () => {
  it("addColumn 唯一 id 自动生成 + scene 列预置双容器", () => {
    const { story, id } = addColumn(sample);
    expect(story.columns).toHaveLength(3);
    expect(id).toBe("column-3");
    const scene = addColumn(story, { kind: "scene" });
    expect(scene.story.columns[3]).toEqual({
      id: "column-4",
      kind: "scene",
      elements: [],
      entry: [],
    });
    const named = addColumn(scene.story, { id: "finale" });
    expect(named.story.columns).toHaveLength(5);
    expect(named.story.columns[4]?.id).toBe("finale");
    expect(addColumn(scene.story, { id: "start" }).story.columns).toHaveLength(
      4,
    );
  });

  it("removeColumn 不存在返回 null", () => {
    expect(removeColumn(sample, "ghost")).toBeNull();
    const next = removeColumn(sample, "inn");
    expect(next?.columns).toHaveLength(1);
    expect(next?.columns[0]?.commands?.[1]).toEqual({
      op: "jump",
      target: "inn",
    });
  });

  it("renameColumn 同步全部列内 jump/menu/navigate 引用", () => {
    const story: Story = {
      formatVersion: 1,
      id: "d",
      entry: "start",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "jump", target: "inn" },
            {
              op: "menu",
              prompt: "m",
              options: [
                { text: "去", target: "inn" },
                { text: "留", target: "start" },
              ],
            },
            { op: "navigate", path: "inn" },
            { op: "navigate", path: "somewhere", scene: "inn" },
          ],
        },
        { id: "inn", kind: "flow", commands: [{ op: "say", text: "x" }] },
      ],
    };
    const next = renameColumn(story, "inn", "tavern");
    expect(next?.columns[1]?.id).toBe("tavern");
    expect(next?.columns[0]?.commands?.[0]).toEqual({
      op: "jump",
      target: "tavern",
    });
    expect(next?.columns[0]?.commands?.[1]).toMatchObject({
      options: [{ target: "tavern" }, { target: "start" }],
    });
    expect(next?.columns[0]?.commands?.[2]).toEqual({
      op: "navigate",
      path: "tavern",
    });
    expect(next?.columns[0]?.commands?.[3]).toEqual({
      op: "navigate",
      path: "somewhere",
      scene: "tavern",
    });
    expect(snapshot(story)).not.toBe(snapshot(next));
  });

  it("renameColumn：无 scene 时 path 才承载目标；撞名/缺失返回 null；同名 no-op 返回原引用", () => {
    expect(renameColumn(sample, "inn", "start")).toBeNull();
    expect(renameColumn(sample, "ghost", "x")).toBeNull();
    expect(renameColumn(sample, "inn", "inn")).toBe(sample);
  });

  it("insertCommand / updateCommandField / moveCommand 便捷面", () => {
    const added = insertCommand(sample, "inn", "commands", {
      op: "wait",
      seconds: 2,
    });
    expect(added?.columns[1]?.commands).toHaveLength(2);
    expect(
      insertCommand(sample, "ghost", "commands", { op: "wait", seconds: 1 }),
    ).toBeNull();
    expect(
      insertCommand(sample, "inn", "entry", { op: "wait", seconds: 1 }),
    ).toBeNull();
    const updated = updateCommandField(
      sample,
      "/columns/0/commands/0",
      "text",
      "新文本",
    );
    expect(getAtPointer(updated, "/columns/0/commands/0/text")).toBe("新文本");
    const moved = moveCommand(sample, "/columns/0/commands/1", 0);
    expect(getAtPointer(moved, "/columns/0/commands/0")).toEqual({
      op: "jump",
      target: "inn",
    });
  });
});

describe("EditorSession（统一 undo 锚点）", () => {
  it("commit → undo → redo 往返，一次提交一个单元", () => {
    const session = new EditorSession(sample);
    const first = setAtPointer(sample, "/columns/0/commands/0/text", "A")!;
    session.commit("改 A", first);
    const second = setAtPointer(first, "/columns/0/commands/0/text", "B")!;
    session.commit("改 B", second);
    expect(session.undoDepth).toBe(2);
    expect(session.canRedo).toBe(false);
    expect(session.undo()).toBe(true);
    expect(session.story).toBe(first);
    expect(session.canRedo).toBe(true);
    expect(session.redo()).toBe(true);
    expect(session.story).toBe(second);
    expect(session.undoDepth).toBe(2);
  });

  it("提交后 redo 尾清空（新分支时间线）", () => {
    const session = new EditorSession(sample);
    session.commit(
      "a",
      setAtPointer(sample, "/columns/0/commands/0/text", "A")!,
    );
    session.undo();
    session.commit(
      "b",
      setAtPointer(sample, "/columns/0/commands/0/text", "B")!,
    );
    expect(session.canRedo).toBe(false);
    expect(session.story.columns[0]?.commands?.[0]).toMatchObject({
      text: "B",
    });
  });

  it("同引用提交 no-op；apply 未命中（null）不产生历史单元", () => {
    const session = new EditorSession(sample);
    session.commit("无变更", sample);
    expect(session.undoDepth).toBe(0);
    expect(session.apply("未命中", () => null)).toBe(false);
    expect(session.undoDepth).toBe(0);
    expect(
      session.apply("有效", (story) => setAtPointer(story, "/entry", "inn")),
    ).toBe(true);
    expect(session.story.entry).toBe("inn");
  });

  it("容量淘汰最旧单元：undo 到底 = 最旧保留单元的 before", () => {
    const session = new EditorSession(sample, { undoCapacity: 3 });
    for (let i = 0; i < 5; i += 1) {
      session.commit(
        `step-${i}`,
        setAtPointer(session.story, "/columns/0/commands/0/text", `t${i}`)!,
      );
    }
    expect(session.undoDepth).toBe(3);
    while (session.canUndo) session.undo();
    expect(getAtPointer(session.story, "/columns/0/commands/0/text")).toBe(
      "t1",
    );
    expect(session.canUndo).toBe(false);
    for (let i = 0; i < 3; i += 1) expect(session.redo()).toBe(true);
    expect(getAtPointer(session.story, "/columns/0/commands/0/text")).toBe(
      "t4",
    );
    expect(session.canRedo).toBe(false);
  });

  it("一处改动全视图同步：多订阅者同收新引用，退订后不再收", () => {
    const session = new EditorSession(sample);
    const seenA: Story[] = [];
    const seenB: Story[] = [];
    const unsubscribe = session.subscribe((story) => seenA.push(story));
    session.subscribe((story) => seenB.push(story));
    session.commit("x", setAtPointer(sample, "/entry", "inn")!);
    session.undo();
    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(2);
    expect(seenA[0]).toBe(seenB[0]);
    unsubscribe();
    session.commit("y", setAtPointer(sample, "/entry", "start")!);
    expect(seenA).toHaveLength(2);
    expect(seenB).toHaveLength(3);
  });
});
