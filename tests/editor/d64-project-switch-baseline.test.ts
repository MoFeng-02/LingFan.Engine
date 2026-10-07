/**
 * 打开工程 = 新基线会话（同名入口列不撞车）· 源级回归守卫。
 *
 * 缺陷：`applyOpened` 曾按「路径是否在新工程列集中」决定旧文档去留——
 * demo 会话占用的 `Stories/start.json` 在真实工程入口列同名时被判
 * 「已开：复用」，demo 内容留在真实工程的入口标签里，一次保存即把
 * demo 内容写进真实工程文件（数据损坏路径）。
 *
 * 守卫两条：① `applyOpened` 必须在 `openColumnDocument` **之前**关闭全部
 * 既有文档；② 旧的「按路径过滤保留」写法不得回流。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** `applyOpened` 函数体切片（起于函数声明，止于下一个顶层函数） */
function applyOpenedBlock(): string {
  const src = code(appSource);
  const start = src.indexOf("function applyOpened");
  const end = src.indexOf("function unbindProject", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("打开工程 = 新基线会话 · 防同名入口列撞车", () => {
  it("applyOpened 先关闭全部既有文档，再打开新工程入口列", () => {
    const block = applyOpenedBlock();
    const closeAll = block.indexOf("for (const doc of [...workspace.documents])");
    const openEntry = block.indexOf("openColumnDocument(tree.entry)");
    expect(closeAll).toBeGreaterThan(-1);
    expect(openEntry).toBeGreaterThan(closeAll); // 顺序：先清旧会话，再开新入口
  });

  it("按路径过滤保留旧文档的写法不得回流", () => {
    const block = applyOpenedBlock();
    expect(block).not.toContain("ordered.includes(path)) workspace.close(path)");
    expect(block).not.toContain("if (!ordered.includes(path))");
  });
});
