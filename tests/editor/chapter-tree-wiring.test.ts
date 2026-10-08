/**
 * 章节树**接线互锁**。
 *
 * 为什么需要：判据 `buildChapterIndex` 早就有（`chapter-index.test.ts` 全绿），
 * `ChapterTree.vue` 组件也写好了 —— 但**没接进主界面**（左栏仍是文件树，
 * 文档 tab 平铺，用户失去结构感）。**判据绿 ≠ 能力可用**。
 *
 * 本守卫锁的是**「某能力必须接在某处」**这一类性质（与同类源级接线守卫同风格）：
 * 这些性质在界面上表现为「看起来对」，但一旦被拆掉，判据测试**依然全绿**。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import chapterTreeSource from "../../apps/editor/src/components/ChapterTree.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("章节树 · 接线互锁（防「判据绿但没接上」）", () => {
  it("App.vue **import 并渲染** ChapterTree（能力真的接进了主界面）", () => {
    const src = code(appSource);
    expect(src).toContain('import ChapterTree from "./components/ChapterTree.vue"');
    // 必须用**词边界**：`toContain("<ChapterTree")` 会被 `ChapterTreeDX` 前缀匹配骗过
    //    （自证时实测：把标签改名成 `ChapterTreeDX` 守卫仍绿）⇒ 守卫形同虚设。
    expect(src).toMatch(/<ChapterTree\s/);
  });

  it("章节内页有**自己的 tab 位**（`leftTab === 'chapters'` 落到单根元素上）", () => {
    const src = code(appSource);
    // v-show 必须落在单根元素（组件可能是多根模板 ⇒ 直接给它 v-show 会失效）
    expect(src).toContain("leftTab === 'chapters'");
    // tab 定义与渲染两侧都有（只加一侧 = 用户点不到）
    expect(src).toContain('id: "chapters"');
  });

  it("**与「列」并存，不互相取代**（判据明令：两者语义不同）", () => {
    // 设计意图（`ChapterTree.vue` 头部）：手动分组是作者显式编排，章节树是路径推导的客观结构
    const src = code(appSource);
    expect(src).toMatch(/<ColumnList\s/);
    expect(src).toMatch(/<ChapterTree\s/);
    expect(src).toContain('id: "columns"');
    expect(src).toContain('id: "chapters"');
  });

  it("路径面经 provide 注入（章节 = 路径目录，没有它章节树退化为平铺）", () => {
    expect(code(appSource)).toContain("provide(COLUMN_PATHS_KEY");
  });

  it("路径来源是**工程的列**（`sourcePath`），**不是已打开的文档**", () => {
    // 用 `workspace.documents` 推导路径会出错 ——
    //    `Workspace` 有**容量上限 `capacity = 50`**，打开更多列的工程
    //    会挤掉其余列（entry 列最早打开、最先被挤掉），
    //    那些列在章节树里**没有路径** ⇒ label 为空。
    //    权威来源是**组装器回填的 `sourcePath`**（工程级事实，与「哪些文档还开着」无关）。
    const src = code(appSource);
    expect(src).toContain("column.sourcePath");
    expect(src).toMatch(/columnPaths\s*=\s*computed/);
    // 反面：不得退回「用文档集合推导」（会漏列）
    expect(src).not.toContain("workspace.documents.flatMap");
  });

  it("组件**复用判据**（不自己再算一份分组 / 不自己拼摘要文案）", () => {
    const src = code(chapterTreeSource);
    // 分组 = 判据单一入口（`chapterGroupOf` 在其内部被调，组件不该自己判）
    expect(src).toContain("buildChapterIndex");
    // 摘要文案同样是判据（`chapterSummaryText`）——组件里拼字符串就会与判据漂移
    expect(src).toContain("chapterSummaryText");
    // 反面：组件不得自己写分组判定（用 `isReplayableColumn` 就是第二份定义）
    expect(src).not.toContain("isReplayableColumn");
  });
});
