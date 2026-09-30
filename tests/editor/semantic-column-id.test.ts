/**
 * 语义化列 id 生成测试。
 *
 * 测试纪律：
 * - 纯函数语义：建议 → 唯一化（`-2`/`-3` 递增取空位）→ 兜底（`column-N` 跳已占号）
 * - hint 是建议非命令：不安全输入（路径分隔 / 点段 / 空）回退兜底，不抛、不改写
 * - addColumn 契约只增：显式 id 语义不变（撞名 fail-closed），hint 仅缺省 id 时参与
 * - 源码互锁：编辑器「+列」走 prompt（留空可过）→ api.addColumn(kind, hint)
 */
import { describe, expect, it } from "vitest";
import { parseStory } from "@lingfan/engine";
import { addColumn, suggestColumnId } from "@lingfan/editor";
import columnListSource from "../../apps/editor/src/components/ColumnList.vue?raw";

function storyWith(...ids: string[]): ReturnType<typeof parseStory> {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: ids[0] ?? "start",
    columns: (ids.length > 0 ? ids : ["start"]).map((id) => ({
      id,
      kind: "flow",
      commands: [{ op: "say", text: "句" }],
    })),
  });
}

describe("suggestColumnId：建议 → 唯一化 → 兜底", () => {
  it("语义建议直接可用", () => {
    expect(suggestColumnId("tavern", ["start", "end"])).toBe("tavern");
  });

  it("重名自动取空位（tavern / tavern-2 / tavern-3；中间空位即用）", () => {
    expect(suggestColumnId("tavern", ["tavern"])).toBe("tavern-2");
    expect(suggestColumnId("tavern", ["tavern", "tavern-2"])).toBe("tavern-3");
    expect(suggestColumnId("tavern", ["tavern", "tavern-3"])).toBe("tavern-2");
  });

  it("首尾空白修剪；大小写原样（作者意图不静默改写）", () => {
    expect(suggestColumnId("  tavern  ", [])).toBe("tavern");
    expect(suggestColumnId("Tavern", [])).toBe("Tavern");
  });

  it("无输入 / 空白 / 不安全输入 → column-N 兜底（跳过已占号）", () => {
    expect(suggestColumnId(undefined, ["column-1", "column-2"])).toBe(
      "column-3",
    );
    expect(suggestColumnId(null, [])).toBe("column-1");
    expect(suggestColumnId("   ", [])).toBe("column-1");
    expect(suggestColumnId("a/b", ["column-1"])).toBe("column-2");
    expect(suggestColumnId("..", [])).toBe("column-1");
    expect(suggestColumnId(".hidden", [])).toBe("column-1");
  });
});

describe("addColumn 接线：hint 仅缺省 id 时参与（契约只增）", () => {
  it("带 hint 新建 = 语义 id 且唯一（重名建议递增）", () => {
    const story = storyWith("tavern");
    const { story: next, id } = addColumn(story, {
      kind: "flow",
      hint: "tavern",
    });
    expect(id).toBe("tavern-2");
    expect(next.columns.at(-1)?.id).toBe("tavern-2");
  });

  it("无 hint = column-N 兜底（既有语义不变）", () => {
    const { id } = addColumn(storyWith("start"), { kind: "flow" });
    expect(id).toBe("column-2");
  });

  it("显式 id 撞名 fail-closed 原样返回（不吞建议、不改故事）", () => {
    const story = storyWith("tavern");
    const result = addColumn(story, { id: "tavern", hint: "inn" });
    expect(result.id).toBe("tavern");
    expect(result.story).toBe(story);
  });
});

describe("源码互锁：编辑器「+列」接语义化建议输入", () => {
  it("+列 走 prompt（留空可过）→ api.addColumn(kind, hint ?? undefined)", () => {
    expect(columnListSource).toContain("promptAddColumn");
    expect(columnListSource).toContain("api.addColumn(kind, hint ?? undefined)");
    expect(columnListSource).toContain("window.prompt");
  });
});
