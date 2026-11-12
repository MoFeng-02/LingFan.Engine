/**
 * 直达清单的判据。
 *
 * 清单是磁盘事实的投影：它列出的列就是引擎能进的列。判据用真实工程根
 * （临时目录里造最小工程）跑一遍完整链路——扫描 → 解析 → 取列 id，
 * 因为「清单里有的列引擎能不能进」只有真产物说了算。
 *
 * 每个用例独立工程根：故事文件按 id 命名，同进程内重复造同路径会互相覆盖。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  listDevEntries,
  resolveDevTarget,
} from "../../packages/stories-build/src/dev/entries.ts";

const BASE = fileURLToPath(new URL("./.tmp-dev-entries/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

/** 造一个只含故事产物的工程根（资源根下的故事目录） */
function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, "Resources", "Stories", rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** 单列原子文件：id + kind + commands（命令列的最小可用形态） */
function singleColumn(id: string): string {
  return JSON.stringify({
    formatVersion: 1,
    id,
    kind: "flow",
    commands: [{ op: "say", text: id }],
  });
}

describe("直达清单", () => {
  it("扫出的列 id 来自文件内容，不是文件名", () => {
    const root = makeProject("ids", {
      "chapter1/inn.json": singleColumn("inn"),
      "chapter2/stage-demo.json": singleColumn("stage_demo"),
    });
    const entries = listDevEntries(root);
    const ids = entries.entries.map((entry) => entry.id);
    expect(ids).toContain("inn");
    expect(ids).toContain("stage_demo");
    expect(ids).not.toContain("stage-demo");
  });

  it("条目带出列所在的产物文件路径", () => {
    const root = makeProject("paths", {
      "chapter1/inn.json": singleColumn("inn"),
    });
    const entries = listDevEntries(root);
    expect(entries.entries).toEqual([
      { id: "inn", sourcePath: "Stories/chapter1/inn.json" },
    ]);
  });

  it("多列文件里的每一列都进清单", () => {
    const root = makeProject("multi", {
      "chapter1/tour.json": JSON.stringify({
        formatVersion: 1,
        id: "tour",
        entry: "tour_a",
        columns: [
          { id: "tour_a", kind: "flow", commands: [{ op: "say", text: "a" }] },
          { id: "tour_b", kind: "flow", commands: [{ op: "say", text: "b" }] },
        ],
      }),
    });
    const entries = listDevEntries(root);
    expect(entries.entries.map((entry) => entry.id)).toEqual([
      "tour_a",
      "tour_b",
    ]);
  });

  it("两次扫描顺序一致", () => {
    const root = makeProject("stable", {
      "chapter2/b.json": singleColumn("b"),
      "chapter1/a.json": singleColumn("a"),
    });
    const first = listDevEntries(root).entries.map((entry) => entry.id);
    const second = listDevEntries(root).entries.map((entry) => entry.id);
    expect(first).toEqual(second);
  });

  it("故事目录为空时明确报错，不返回空清单", () => {
    const root = makeProject("empty", {});
    expect(() => listDevEntries(root)).toThrow(/未找到故事文件/);
  });

  it("坏文件报错并带出文件路径，不静默跳过", () => {
    const root = makeProject("broken", {
      "chapter1/bad.json": "{ 不是合法 JSON",
    });
    expect(() => listDevEntries(root)).toThrow(/chapter1\/bad\.json/);
  });

  it("同名列出现在多个文件时登记为歧义", () => {
    const root = makeProject("ambiguous", {
      "chapter1/a.json": singleColumn("dup"),
      "chapter2/b.json": singleColumn("dup"),
    });
    const entries = listDevEntries(root);
    expect(entries.ambiguous.dup).toEqual([
      "Stories/chapter1/a.json",
      "Stories/chapter2/b.json",
    ]);
  });
});

describe("直达目标判定", () => {
  it("命中唯一列时给出该列", () => {
    const root = makeProject("hit", {
      "chapter1/inn.json": singleColumn("inn"),
    });
    const target = resolveDevTarget(listDevEntries(root), "inn");
    expect(target.ok).toBe(true);
    expect(target.ok && target.entry.id).toBe("inn");
  });

  it("列不存在时给出 unknown 与空候选", () => {
    const root = makeProject("miss", {
      "chapter1/inn.json": singleColumn("inn"),
    });
    const target = resolveDevTarget(listDevEntries(root), "nope");
    expect(target.ok).toBe(false);
    expect(!target.ok && target.reason).toBe("unknown");
    expect(!target.ok && target.candidates).toEqual([]);
  });

  it("同名列时给出 ambiguous 与候选文件", () => {
    const root = makeProject("dup", {
      "chapter1/a.json": singleColumn("dup"),
      "chapter2/b.json": singleColumn("dup"),
    });
    const target = resolveDevTarget(listDevEntries(root), "dup");
    expect(target.ok).toBe(false);
    expect(!target.ok && target.reason).toBe("ambiguous");
    expect(!target.ok && target.candidates.length).toBe(2);
  });
});
