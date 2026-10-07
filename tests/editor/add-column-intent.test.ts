/**
 * 「+ 列」对话框意图判定（`decideAddColumn`）测试 —— 回归守卫。
 *
 * 回归：`promptAddColumn` 把对话框的 `null`（取消）经 `hint ?? undefined`
 * 传成 `undefined` ⇒ **按 Esc 却凭空多出一列**（而同文件的 `promptRename` / `promptAddGroup`
 * 都写了 `=== null` 守卫，唯此处漏了）。
 *
 * 测试要点五类：
 * - 纯函数真值表：`null`（取消）→ 不执行；`""`（留空）→ 执行且无建议；非空 → 执行且带建议
 * - 拟态作者旅程：把判定与引擎的 `addColumn` **串起来**跑三条路径，断言列数 / id 的实际结果
 *   （只测真值表不足以证明"按 Esc 不会多一列"——那要靠组合行为）
 * - 故意错误：对抗性输入（空白串 / 路径分隔 / 点段 / 超长）**不由本层拒绝**，而是原样交给
 *   引擎 `suggestColumnId` 去 trim / 兜底 —— 本层只判"是否执行"，职责单一（越权拒绝会
 *   造出第二处 id 规则 = 第二份定义）
 * - 边界：`null` 与 `""` 必须**可区分**（这正是「取消被当成留空」的根因）
 * - 源级互锁：见 `semantic-column-id.test.ts`（`decideAddColumn` 调用必须先于 `api.addColumn`）
 */
import { describe, expect, it } from "vitest";
import { parseStory } from "@lingfan/engine";
import { addColumn } from "@lingfan/editor";
import { decideAddColumn } from "../../apps/editor/src/addColumnIntent";

describe("真值表：取消 / 留空 / 有值 三态互不相同", () => {
  it("取消（null）→ 不执行", () => {
    expect(decideAddColumn(null)).toEqual({ run: false });
  });

  it("留空（\"\"）→ 执行，且无建议（引擎兜底 column-N）", () => {
    expect(decideAddColumn("")).toEqual({ run: true, hint: undefined });
  });

  it("有值 → 执行，且原样作为建议 id", () => {
    expect(decideAddColumn("tavern")).toEqual({
      run: true,
      hint: "tavern",
    });
  });

  it("取消与留空必须是两个不同的判定结果（二者的根因就是被压平）", () => {
    expect(decideAddColumn(null)).not.toEqual(decideAddColumn(""));
  });
});

describe("职责单一：本层只判「是否执行」，不越权校验 id", () => {
  it("空白串 / 不安全字符 / 超长串都原样交给引擎，不当成取消、不在此拒绝", () => {
    for (const raw of [
      "   ",
      "a/b",
      "..",
      ".hidden",
      "tavern\n",
      "x".repeat(300),
    ]) {
      const intent = decideAddColumn(raw);
      expect(intent.run).toBe(true);
      expect(intent.hint).toBe(raw);
    }
  });
});

describe("拟态作者旅程：判定 + 引擎提交串起来跑三条路径", () => {
  function story() {
    return parseStory({
      formatVersion: 1,
      id: "t",
      entry: "start",
      columns: [{ id: "start", kind: "flow", commands: [{ op: "say", text: "句" }] }],
    });
  }

  /** 复刻 `App.vue` 的 `addColumn` 接线：仅当 `run` 为真才提交 */
  function applyPrompt(raw: string | null): { count: number; id?: string } {
    const base = story();
    const intent = decideAddColumn(raw);
    if (!intent.run) return { count: base.columns.length };
    const result = addColumn(base, { kind: "flow", hint: intent.hint });
    return { count: result.story.columns.length, id: result.id };
  }

  it("① 按 Esc（取消）→ 列数不变（回归：改前会多出一列）", () => {
    expect(applyPrompt(null)).toEqual({ count: 1 });
  });

  it("② 确定但留空 → 新增一列，id 由引擎兜底为 column-N", () => {
    const result = applyPrompt("");
    expect(result.count).toBe(2);
    expect(result.id).toMatch(/^column-\d+$/);
  });

  it("③ 输入 tavern → 新增一列且 id 为 tavern", () => {
    expect(applyPrompt("tavern")).toEqual({ count: 2, id: "tavern" });
  });
});
