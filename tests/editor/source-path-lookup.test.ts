/**
 * 真机缺陷批次（2026-10-05 用户实测五连）判据测试：
 * 「点击资源树里的 `.story` 文件」⇒ 打开该文件**列序第一**的列。
 *
 * 真实工程形态：一个 `.story` 承载多列（`chapter1.story` = 4 列），
 * 文件路径与列 id 天然不同族 ⇒ 文档身份合成路径（`Stories/<id>.json`）
 * 对 `.story` 工程**永不命中**（旧 `columnIdOfDocument` 后缀门）。
 */
import { describe, expect, it } from "vitest";
import { firstColumnIdOfSourcePath } from "@lingfan/editor";
import type { Story } from "@lingfan/engine";

const col = (id: string, sourcePath?: string) =>
  ({ id, kind: "flow", commands: [], ...(sourcePath === undefined ? {} : { sourcePath }) }) as never;

const tree = {
  formatVersion: 1,
  id: "demo",
  entry: "a",
  columns: [col("a", "Stories/chapter1/chapter1.story"), col("b", "Stories/chapter1/chapter1.story"), col("c", "Stories/chapter2/chapter2.story"), col("d")],
} as unknown as Story;

describe("firstColumnIdOfSourcePath · 反查判据", () => {
  it(".story 文件 ⇒ 该文件**列序第一**的列（多列同文件，确定性）", () => {
    expect(firstColumnIdOfSourcePath(tree, "Stories/chapter1/chapter1.story")).toBe("a");
    expect(firstColumnIdOfSourcePath(tree, "Stories/chapter2/chapter2.story")).toBe("c");
  });

  it("无 sourcePath 的列**不参与**（默认路径文件由 columnIdOfDocument 先行命中）", () => {
    // "Stories/d.json" 这类合成路径在磁盘上确实可能存在，但反查只认显式 sourcePath
    expect(firstColumnIdOfSourcePath(tree, "Stories/d.json")).toBeUndefined();
  });

  it("未命中 ⇒ undefined（调用方给可操作提示，不静默、不猜）", () => {
    expect(firstColumnIdOfSourcePath(tree, "Stories/不存在.story")).toBeUndefined();
  });
});
