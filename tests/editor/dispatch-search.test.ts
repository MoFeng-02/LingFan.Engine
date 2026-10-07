/**
 * 分派表 + 全局搜索模型（纯函数，可测）。
 * 拟态旅程形态：真实工程的语料上搜「say」「金币」，看命中位置与截断口径。
 */
import { describe, expect, it } from "vitest";
import {
  isEditableKind,
  registeredKinds,
  viewOfKind,
} from "../../apps/editor/src/dispatch";
import { searchResources } from "../../apps/editor/src/search";

describe("分派表 · 路由", () => {
  it("故事 → 可编辑的故事视图", () => {
    expect(viewOfKind("story")).toEqual({ view: "story", editable: true, title: "故事" });
    expect(isEditableKind("story")).toBe(true);
  });

  it("译文表 / 清单 → 各自的专用视图", () => {
    expect(viewOfKind("lang").view).toBe("lang");
    expect(viewOfKind("lang").editable).toBe(true);
    expect(viewOfKind("manifest").view).toBe("manifest");
    expect(isEditableKind("manifest")).toBe(true);
  });

  it("媒体 → 预览视图但**不可改**（不假装能编辑二进制）", () => {
    for (const kind of ["image", "audio", "video"]) {
      expect(viewOfKind(kind).view).toBe("media");
      expect(isEditableKind(kind)).toBe(false);
    }
  });

  it("Saves 与未识别资源 → 只读视图（不隐藏、不报错）", () => {
    expect(viewOfKind("saves").view).toBe("readonly");
    expect(viewOfKind("saves").editable).toBe(false);
    expect(viewOfKind("other").view).toBe("readonly");
  });

  it("未登记的种类 ⇒ 归 readonly 而**不抛错**（新增资源不改布局即可接入）", () => {
    expect(() => viewOfKind("brand-new-kind")).not.toThrow();
    expect(viewOfKind("brand-new-kind").view).toBe("readonly");
  });

  it("完备账：`ResourceKind` 的每个成员都有登记（漏登记会被抓到）", () => {
    const all = ["story", "lang", "image", "audio", "video", "manifest", "saves", "other"];
    expect(registeredKinds()).toEqual([...all].sort());
  });
});

describe("全局搜索 · 命中判据", () => {
  const corpus = new Map([
    ["Stories/start.json", '{\n  "op": "say",\n  "text": "金币不够"\n}'],
    ["Stories/inn.json", '{\n  "op": "jump",\n  "target": "tavern"\n}'],
    ["Lang/en/title_main.json", '{\n  "金币": "Gold"\n}'],
  ]);

  it("中文子串命中，带行号（1 基）与列位置", () => {
    const report = searchResources(corpus, "金币");
    const paths = report.hits.map((h) => h.path);
    expect(paths).toContain("Stories/start.json");
    expect(paths).toContain("Lang/en/title_main.json");
    const hit = report.hits.find((h) => h.path === "Lang/en/title_main.json")!;
    expect(hit.line).toBe(2);
    // 第 2 行是 `  "金币": "Gold"` ⇒ 引号在列 2，金币起于列 3
    expect(hit.column).toBe(3);
    expect(hit.text).toContain("金币");
    expect(hit.kind).toBe("lang"); // 种类复用资源树判据
  });

  it("大小写不敏感（默认）⇒ `Gold` 与 `gold` 都命中", () => {
    expect(searchResources(corpus, "gold").hits.length).toBeGreaterThan(0);
    expect(searchResources(corpus, "gold", { caseSensitive: true }).hits.length).toBe(0);
  });

  it("确定性：语料插入顺序不同也产出同序结果（按路径码元序遍历）", () => {
    const forward = searchResources(corpus, "金币");
    const reversed = searchResources(
      new Map([...corpus.entries()].reverse()),
      "金币",
    );
    expect(reversed.hits.map((h) => h.path)).toEqual(forward.hits.map((h) => h.path));
  });

  it("空查询 ⇒ 零命中且**不扫描**（不该因空白输入触发全量遍历）", () => {
    const report = searchResources(corpus, "");
    expect(report.hits).toEqual([]);
    expect(report.searchedFiles).toBe(0);
  });

  it("无匹配 ⇒ 零命中但如实报告搜过几个文件（区分「没结果」与「没东西可搜」）", () => {
    const report = searchResources(corpus, "不存在的词");
    expect(report.hits).toEqual([]);
    expect(report.searchedFiles).toBe(3);
    expect(report.truncated).toBe(false);
  });

  it("上限截断 ⇒ `truncated` 如实为真（不谎报「共 N 条」）", () => {
    const many = new Map<string, string>([["a.json", "x\n".repeat(50)]]);
    const report = searchResources(many, "x", { limit: 5 });
    expect(report.hits).toHaveLength(5);
    expect(report.truncated).toBe(true);
  });

  it("超出上限的第一个文件就停（不白扫后续文件）", () => {
    const many = new Map<string, string>([
      ["a.json", "x\n".repeat(50)],
      ["b.json", "x\n".repeat(50)],
    ]);
    const report = searchResources(many, "x", { limit: 3 });
    expect(report.searchedFiles).toBe(1);
  });
});
