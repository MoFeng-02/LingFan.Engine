/**
 * 单文档写回的期望集组装：多文档面防丢数据的守门人。
 * 核心红线：**只改一个文件时，其他文件必须逐字节不动**。
 */
import { describe, expect, it } from "vitest";
import {
  diffProjectFiles,
  parseStory,
  serializeColumnDocument,
} from "@lingfan/engine";
import { assembleColumnWrite } from "../../apps/editor/src/columnWrite";

const manifestText = JSON.stringify(
  { formatVersion: 1, id: "demo", entry: "start", name: "示例" },
  null,
  2,
);
const startText = JSON.stringify(
  { formatVersion: 1, id: "start", kind: "flow", commands: [{ op: "say", text: "开场" }] },
  null,
  2,
);
const tavernText = JSON.stringify(
  { formatVersion: 1, id: "tavern", kind: "flow", commands: [{ op: "say", text: "酒馆" }] },
  null,
  2,
);

/** 三文件工程的打开基线（清单 + 两列） */
const baseline = (): Map<string, string> =>
  new Map([
    ["project.json", manifestText],
    ["Stories/start.json", startText],
    ["Stories/tavern.json", tavernText],
  ]);

const editedTavern = (text: string) =>
  serializeColumnDocument(
    parseStory(
      { formatVersion: 1, id: "tavern", kind: "flow", commands: [{ op: "say", text }] },
      "tavern.json",
    ),
    "tavern",
  ).files;

describe("assembleColumnWrite（单文档写回 → 整工程期望集）", () => {
  it("只改一列 ⇒ 差量恰一项、零删除、清单逐字节不动", () => {
    const wanted = assembleColumnWrite(baseline(), { files: editedTavern("酒馆改") });
    const diff = diffProjectFiles(wanted, baseline());
    expect([...diff.changes.keys()]).toEqual(["Stories/tavern.json"]);
    expect(diff.deletes).toEqual([]);
    // 清单原文本（含作者手写排版）一个字节都没动
    expect(wanted.get("project.json")).toBe(manifestText);
    // 未编辑的列文件逐字节保持
    expect(wanted.get("Stories/start.json")).toBe(startText);
  });

  it("确定序：期望集键按码元序（与构造顺序无关）", () => {
    const a = assembleColumnWrite(baseline(), { files: editedTavern("x") });
    const b = assembleColumnWrite(baseline(), { files: editedTavern("x") });
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect([...a.keys()]).toEqual([
      "Stories/start.json",
      "Stories/tavern.json",
      "project.json",
    ]);
  });

  it("多文档依次保存：第二次不得回退第一次的改动（防「后写覆盖先写」）", () => {
    // 标签 a 存过一次 → writer 基线换新（宿主持有）
    const afterA = assembleColumnWrite(baseline(), {
      files: editedTavern("酒馆改"),
    });
    // 标签 b 随后存：它的期望集 = 新基线 + 自己的改动
    const editedStart = serializeColumnDocument(
      parseStory(
        { formatVersion: 1, id: "start", kind: "flow", commands: [{ op: "say", text: "开场改" }] },
        "start.json",
      ),
      "start",
    ).files;
    const afterB = assembleColumnWrite(afterA, { files: editedStart });
    // 两处改动都在，且无删除
    const diff = diffProjectFiles(afterB, baseline());
    expect([...diff.changes.keys()].sort()).toEqual([
      "Stories/start.json",
      "Stories/tavern.json",
    ]);
    expect(diff.deletes).toEqual([]);
  });

  it("显式删除（列被删）才进删除集：不在产物里的列**不会**被顺手删", () => {
    // 产物里没有 start，但没声明删除 ⇒ start 必须保住
    const wanted = assembleColumnWrite(baseline(), { files: editedTavern("酒馆改") });
    expect(wanted.has("Stories/start.json")).toBe(true);
    // 显式声明删除 ⇒ 才删
    const removed = assembleColumnWrite(baseline(), {
      files: editedTavern("酒馆改"),
      deletes: ["Stories/start.json"],
    });
    const diff = diffProjectFiles(removed, baseline());
    expect(diff.deletes).toEqual(["Stories/start.json"]);
  });

  it("fail-closed：删不在基线里的路径 / 同一次既写又删同一路径，两类都拒绝", () => {
    expect(() =>
      assembleColumnWrite(baseline(), {
        files: editedTavern("x"),
        deletes: ["Stories/not-there.json"],
      }),
    ).toThrow(/不在打开基线/);
    expect(() =>
      assembleColumnWrite(baseline(), {
        files: editedTavern("x"),
        deletes: ["Stories/tavern.json"],
      }),
    ).toThrow(/既要写入又要删除/);
  });

  it("内容未变时不产生差量（不重写作者文件）", () => {
    // 文档没改，直接保存 ⇒ 差量为空
    const unchanged = serializeColumnDocument(
      parseStory(
        { formatVersion: 1, id: "tavern", kind: "flow", commands: [{ op: "say", text: "酒馆" }] },
        "tavern.json",
      ),
      "tavern",
    ).files;
    const wanted = assembleColumnWrite(baseline(), { files: unchanged });
    const diff = diffProjectFiles(wanted, baseline());
    // 清单排版与基线一致 ⇒ 无变更；tavern 内容语义相同 ⇒ 跳过
    expect([...diff.changes.keys()]).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });
});
