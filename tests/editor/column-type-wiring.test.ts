/**
 * 场景类型（#7）**接线互锁**：判据有了、组件写了，**没接线就是白做**
 * （chapter-tree-wiring 同款教训：判据绿 ≠ 能力可用）。
 *
 * 锁五条线：ColumnList 徽标与类型选择 · App.vue 透传 · DialogHost choice 渲染 ·
 * dialog 判据集中 · ChapterTree 精确徽标。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import columnListSource from "../../apps/editor/src/components/ColumnList.vue?raw";
import dialogHostSource from "../../apps/editor/src/components/DialogHost.vue?raw";
import dialogSource from "../../apps/editor/src/dialog.ts?raw";
import chapterTreeSource from "../../apps/editor/src/components/ChapterTree.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("场景类型 · 接线互锁", () => {
  it("🔴 ColumnList **import 并使用** sceneTypeBadgeOf（徽标文案单一事实源，组件不自写映射）", () => {
    const src = code(columnListSource);
    expect(src).toContain("sceneTypeBadgeOf(column.type)");
    // 反面：分组/可回溯判定是引擎的，组件不得第二真源
    expect(src).not.toContain("isReplayableColumn");
  });

  it("🔴 ColumnList「+列」**真的问类型**（askChoice 存在且取消即不建列）", () => {
    const src = code(columnListSource);
    expect(src).toContain("askChoice");
    // 提交形态：kind, hint, type 三参（改造前是两参 ⇒ 本断言防「对话框白弹」）
    expect(src).toContain("api.addColumn(kind, intent.hint, type");
    expect(src).toContain("if (type === null) return;");
  });

  it("🔴 App.vue api.addColumn **签名与两处分支都透传 type**", () => {
    const src = code(appSource);
    expect(src).toContain('type?: "game" | "menu" | "ui"');
    expect(src).toContain("addColumn(s, { kind, hint, type })");
    expect(src).toContain("addColumn(tree, { kind, hint, type })");
  });

  it("🔴 DialogHost **渲染 choice 形态**（对话框能弹出来才谈得上选）", () => {
    const src = code(dialogHostSource);
    expect(src).toMatch(/request\.kind === ['"]choice['"]/);
  });

  it("🔴 askChoice 判据集中在 parseChoiceAnswer（取消/越界语义不许在调用方各写一份）", () => {
    const src = code(dialogSource);
    expect(src).toContain("parseChoiceAnswer");
  });

  it("🔴 ChapterTree 徽标**精确到 菜单/界面**（node.type 经 sceneTypeBadgeOf，非一律「界面」）", () => {
    const src = code(chapterTreeSource);
    expect(src).toContain("sceneTypeBadgeOf(node.type)");
  });
});
