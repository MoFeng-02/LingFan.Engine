/**
 * 列**场景类型（SceneType）**判据：addColumn 透传 · 徽标文案 · choice 判据。
 *
 * 引擎侧 `StoryColumn.type`（game/menu/ui）与 `isReplayableColumn` 已有守卫；
 * 本文件锁**编辑器侧**三件事：
 * 1. `addColumn` 契约只增的 `type` 选项 —— **缺省与 game 都不落字段**（默认值不显式存储，
 *    新建列内存形态 ≡ 重开解析形态，这是「往返深等」最强不变量的新建侧）
 * 2. `sceneTypeBadgeOf` 徽标文案真值表（列侧栏 / 章节树的单一事实源）
 * 3. `parseChoiceAnswer` 判据（取消/越界一律不执行 —— 「取消 ≠ 缺省」）
 */
import { describe, expect, it } from "vitest";
import { addColumn, chapterGroupOf, buildChapterIndex, sceneTypeBadgeOf } from "@lingfan/editor";
import { parseChoiceAnswer } from "../../apps/editor/src/dialog";
import { sampleStory } from "../../apps/editor/src/sample";

/** 列对象的 JSON 键形态（断言「不落 type 字段」用 —— `in` 检查比 deepEqual 更精确指向字段） */
const jsonOf = (story: ReturnType<typeof addColumn>["story"]) =>
  JSON.parse(JSON.stringify(story)) as { columns: Record<string, unknown>[] };

describe("addColumn · type 透传（契约只增）", () => {
  it("type=menu / ui 落字段", () => {
    const menu = addColumn(sampleStory(), { id: "title_screen", kind: "scene", type: "menu" });
    expect(menu.story.columns.at(-1)).toMatchObject({ id: "title_screen", type: "menu" });
    const ui = addColumn(menu.story, { id: "toast", kind: "flow", type: "ui" });
    expect(ui.story.columns.at(-1)).toMatchObject({ id: "toast", type: "ui" });
  });

  it("type=game 与缺省都**不落字段**（默认值不显式存储 ⇒ 往返深等成立）", () => {
    const game = addColumn(sampleStory(), { id: "a", type: "game" });
    expect("type" in jsonOf(game.story).columns.at(-1)!).toBe(false);
    const plain = addColumn(sampleStory(), { id: "b" });
    expect("type" in jsonOf(plain.story).columns.at(-1)!).toBe(false);
  });

  it("type 与 kind 正交：flow+menu / scene+ui 的容器形态不受影响", () => {
    const flow = addColumn(sampleStory(), { id: "f", kind: "flow", type: "menu" });
    const flowCol = flow.story.columns.at(-1)!;
    expect(flowCol.kind).toBe("flow");
    expect(flowCol.commands).toEqual([]);
    expect(flowCol.type).toBe("menu");
    const scene = addColumn(flow.story, { id: "s", kind: "scene", type: "ui" });
    const sceneCol = scene.story.columns.at(-1)!;
    expect(sceneCol.elements).toEqual([]);
    expect(sceneCol.entry).toEqual([]);
    expect(sceneCol.type).toBe("ui");
  });

  it("type 与 hint（语义化 id 建议）同用不互扰", () => {
    const result = addColumn(sampleStory(), { kind: "scene", hint: "settings", type: "menu" });
    expect(result.id).toBe("settings");
    expect(result.story.columns.at(-1)).toMatchObject({ id: "settings", type: "menu" });
  });

  it("与分组判定互锁：type=menu/ui 的列归界面组（chapterGroupOf 单一判定点）", () => {
    const { story } = addColumn(sampleStory(), { id: "pause_overlay", kind: "scene", type: "ui" });
    const column = story.columns.at(-1)!;
    expect(chapterGroupOf(column)).toBe("ui");
  });

  it("ChapterNode 透传原始 type（组件据此精确区分 菜单/界面，不再按 group 猜）", () => {
    const { story } = addColumn(sampleStory(), { id: "title", kind: "scene", type: "menu" });
    const index = buildChapterIndex([{ path: "Stories/chapter1/title.json", column: story.columns.at(-1)! }]);
    expect(index.ui[0]).toMatchObject({ id: "title", type: "menu" });
  });
});

describe("sceneTypeBadgeOf · 徽标文案真值表（单一事实源）", () => {
  it("menu→菜单 / ui→界面 / game 与缺省→null（game 常态不标）", () => {
    expect(sceneTypeBadgeOf("menu")).toBe("菜单");
    expect(sceneTypeBadgeOf("ui")).toBe("界面");
    expect(sceneTypeBadgeOf("game")).toBeNull();
    expect(sceneTypeBadgeOf(undefined)).toBeNull();
  });
});

describe("parseChoiceAnswer · 取消与越界一律不执行", () => {
  const values = ["game", "menu", "ui"];

  it("命中选项 ⇒ 执行", () => {
    expect(parseChoiceAnswer("menu", values)).toEqual({ run: true, value: "menu" });
  });

  it("取消形态（undefined/false/null）⇒ 不执行（取消 ≠ 缺省）", () => {
    expect(parseChoiceAnswer(undefined, values).run).toBe(false);
    expect(parseChoiceAnswer(false, values).run).toBe(false);
    expect(parseChoiceAnswer(null, values).run).toBe(false);
  });

  it("越界值 ⇒ 不执行（渲染层 bug 不得静默变成「选了第一项」）", () => {
    expect(parseChoiceAnswer("story", values).run).toBe(false);
    expect(parseChoiceAnswer("MENU", values).run).toBe(false); // 大小写敏感：值域即契约
    expect(parseChoiceAnswer("", values).run).toBe(false);
  });

  it("空选项集 ⇒ 任何回答都不执行（fail-closed）", () => {
    expect(parseChoiceAnswer("game", []).run).toBe(false);
  });
});
