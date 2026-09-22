/** 07 §三 工程组装测试：混合形态、确定性、F1 跨文件唯一、入口校验、defines 覆盖序 */
import { describe, expect, it } from "vitest";
import { assembleProject, ProjectAssemblyError } from "./project";
import { StoryEngine } from "./engine";

const manifest = { formatVersion: 1, id: "demo", entry: "start" };

const singleColumn = (id: string): unknown => ({
  formatVersion: 1,
  id,
  kind: "flow",
  commands: [{ op: "say", text: `${id} 的台词` }],
});

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectAssemblyError) return e.issues;
    throw e;
  }
  throw new Error("应当抛出 ProjectAssemblyError");
};

describe("assembleProject", () => {
  it("混合形态组装：单列文件 + 多列文件，路径码元序决定列序", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
      [
        "Stories/ch1.json",
        {
          formatVersion: 1,
          columns: [{ id: "prologue", kind: "flow", commands: [] }],
        },
      ],
    ]);
    const story = assembleProject(manifest, files);
    expect(story.columns.map((c) => c.id)).toEqual(["prologue", "start"]);
    expect(story.entry).toBe("start");
    expect(story.id).toBe("demo");
  });

  it("确定性：文件插入顺序不影响组装结果", () => {
    const entryA = { ...manifest, entry: "a" };
    const a = new Map<string, unknown>([
      ["Stories/b.json", singleColumn("b")],
      ["Stories/a.json", singleColumn("a")],
    ]);
    const b = new Map<string, unknown>([
      ["Stories/a.json", singleColumn("a")],
      ["Stories/b.json", singleColumn("b")],
    ]);
    expect(assembleProject(entryA, a).columns.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(assembleProject(entryA, b).columns.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("F1：跨文件 columnId 重复拒绝，错误带两个文件定位", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
      [
        "Stories/other.json",
        {
          formatVersion: 1,
          columns: [{ id: "start", kind: "flow", commands: [] }],
        },
      ],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("columnId 重复");
    expect(issues.join("\n")).toContain("other.json");
    expect(issues.join("\n")).toContain("start.json");
  });

  it("单列文件名必须等于列 id（AI/编辑器按 id 定位文件的不变量）", () => {
    const files = new Map<string, unknown>([
      ["Stories/wrong.json", singleColumn("start")],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("单列文件名");
  });

  it("defines 合并：工程默认最先，文件按序覆盖（后加载覆盖，01 §一.6）", () => {
    const files = new Map<string, unknown>([
      [
        "Stories/a.json",
        {
          formatVersion: 1,
          id: "a",
          kind: "flow",
          commands: [],
          defines: { "player.gold": 99, "file.only": "a" },
        },
      ],
    ]);
    const story = assembleProject(
      {
        ...manifest,
        entry: "a",
        defines: { "player.gold": 1, "proj.only": true },
      },
      files,
    );
    expect(story.defines).toEqual({
      "player.gold": 99,
      "proj.only": true,
      "file.only": "a",
    });
  });

  it("入口列不存在拒绝（01 §一.7 + F1）", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
    ]);
    const issues = issuesOf(() =>
      assembleProject({ ...manifest, entry: "nope" }, files),
    );
    expect(issues.join("\n")).toContain("入口列");
  });

  it("清单非法（缺 entry / 坏 defines）拒绝", () => {
    expect(
      issuesOf(() =>
        assembleProject({ formatVersion: 1, id: "x" }, new Map()),
      ).join("\n"),
    ).toContain("entry");
    expect(
      issuesOf(() =>
        assembleProject({ ...manifest, defines: "bad" }, new Map()),
      ).join("\n"),
    ).toContain("defines");
  });

  it("坏文件整批拒绝且带文件定位", () => {
    const files = new Map<string, unknown>([
      ["Stories/bad.json", { formatVersion: 2 }],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("bad.json");
    expect(issues.join("\n")).toContain("formatVersion");
  });

  it("组装结果可直接驱动引擎（冒烟）", () => {
    const story = assembleProject(
      manifest,
      new Map([["Stories/start.json", singleColumn("start")]]),
    );
    const engine = new StoryEngine(story);
    engine.start();
    expect(engine.get("__current_dialog_text")).toBe("start 的台词");
  });
});
