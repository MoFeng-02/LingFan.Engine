/**
 * **文档按需打开**守卫（2026-10-05）。
 *
 * 🔴 治的问题：打开工程时**预开所有列** ⇒ 62 列的工程在顶部铺 50 个标签
 * （`Workspace` 容量 50 还会静默截断 12 列 —— `chapter1_start` 是 entry、最早被挤掉）。
 * 用户实测：「50 个 tab 挤成一行，最后一个被截断」。
 *
 * **语义没变**（每个标签仍持**独立单列会话**，防跨标签覆盖 = B0 的数据丢失防线），
 * 变的只是**时机**：用户点到哪一列，才为哪一列建会话。
 *
 * ⚠️ 这个改动横跨三处调用点，任何一处回退都会让「预开所有列」回来：
 * ① `applyOpened`（打开工程）② `selectColumn`（选列）③ `redistributeDocuments`（增删列）
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("文档按需打开 · 接线互锁（防「预开所有列」回流）", () => {
  it("🔴 打开工程**只开入口列**（不再遍历所有列开文档）", () => {
    const src = code(appSource);
    expect(src).toContain("openColumnDocument(tree.entry)");
    // 反面：不得再有「遍历所有列 ⇒ workspace.open」的批量预开
    expect(src).not.toMatch(/for \(const column of tree\.columns\)\s*\{\s*workspace\.open/);
  });

  it("🔴 选列**按需打开**（点到未开的列必须先建会话）", () => {
    // 否则 `selectedColumnId` 会指向一个没有文档的列 ⇒ 时间线/属性面板拿不到内容
    expect(code(appSource)).toContain("openColumnDocument(id)");
  });

  it("🔴 增删列**不补满**未打开的文档（否则一次新增列铺满标签）", () => {
    expect(code(appSource)).toMatch(/if \(doc === undefined\) continue;/);
  });

  it("🔴 新增列后**先建会话再切**（新列从没被打开过）", () => {
    const src = code(appSource);
    expect(src).toContain("openColumnDocument(result.id)");
  });

  it("🔴 切片口径仍是**单列**（整树塞进每个标签 = 跨标签覆盖）", () => {
    // 每个文档只持自己那一列 + 整树作为上下文（`entry` 指向自己）
    const src = code(appSource);
    expect(src).toContain("columns: [column]");
    expect(src).toContain("entry: id");
  });

  it("**入口列始终有文档**（打开工程后至少一个标签，不留空态）", () => {
    // `applyOpened` 必须先开 entry，再把它设为活动文档
    const src = code(appSource);
    const open = src.indexOf("openColumnDocument(tree.entry)");
    const activate = src.indexOf("workspace.activate(storyDocumentPath(tree.entry))");
    expect(open).toBeGreaterThan(-1);
    expect(activate).toBeGreaterThan(open); // 顺序：先开，再激活
  });
});
