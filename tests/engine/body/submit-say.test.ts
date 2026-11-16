/**
 * `submitSceneOps` 里的 `say`（组件内对话）测试。
 *
 * 语义要点：
 * - 组件可以 `say`：文本上屏、进对话等待态，`submitSceneOps` 返回 `true`
 * - 停在等待态**不算失败**：`SYS.waiting` / 对话镜像 / 已改的状态都保留
 * - 组件是原子：连续两句 `say` 塌陷成同一坐标的检查点，`back()` 一次退出整个组件，
 *   而不是逐句回退
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
}

/**
 * 构造：`a` 列先说一句（留下一个常规检查点），再 `navigate` 进 `room`。
 * `room` 是有身体的纯视觉房间，进列后没有任何等待态——正好是组件提交的场合。
 */
function makeEngine(): Harness {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      defines: { visits: 0 },
      columns: [
        {
          id: "a",
          kind: "scene",
          body: { name: "hall" },
          entry: [{ op: "say", text: "开场" }],
        },
        { id: "room", kind: "scene", body: { name: "kitchen" } },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => errors.push(e));
  engine.start();
  engine.advance();
  engine.navigate("room");
  return { engine, errors };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload.kind === "engine.error" ? e.payload.code : ""));
}

describe("submitSceneOps · 组件内 say", () => {
  it("say 允许执行：返回 true、文本上屏、进对话等待态", () => {
    const { engine, errors } = makeEngine();
    expect(engine.get(SYS.waiting)).toBe("none");
    const ok = engine.submitSceneOps([{ op: "say", text: "组件说的话" }]);
    expect(ok).toBe(true);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("组件说的话");
    expect(errorCodes(errors)).toEqual([]);
  });

  it("say 之前的状态变更保留（停在等待态不算失败，不回滚）", () => {
    const { engine } = makeEngine();
    const ok = engine.submitSceneOps([
      { op: "set", key: "visits", value: "+= {1}" },
      { op: "say", text: "来客了" },
    ]);
    expect(ok).toBe(true);
    expect(engine.get("visits")).toBe(1);
    expect(engine.get(SYS.waiting)).toBe("dialog");
  });

  it("连续两句 say ⇒ 历史只增一格（同坐标原位替换）", () => {
    const { engine } = makeEngine();
    const before = engine.historyLength();
    engine.submitSceneOps([{ op: "say", text: "第一句" }]);
    engine.advance();
    const afterFirst = engine.historyLength();
    engine.submitSceneOps([{ op: "say", text: "第二句" }]);
    engine.advance();
    const afterSecond = engine.historyLength();
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
  });

  it("组件内 say 之后 back() 一次就退出整段对话（不逐句回退）", () => {
    const { engine } = makeEngine();
    const cursorAtEntry = engine.historyCursor();
    engine.submitSceneOps([
      { op: "set", key: "visits", value: "+= {1}" },
      { op: "say", text: "第一句" },
    ]);
    engine.advance();
    // 第二句停在对话等待态：此刻 back() 应一次退回进组件那一步
    engine.submitSceneOps([{ op: "say", text: "第二句" }]);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get("visits")).toBe(1);
    engine.back();
    expect(engine.historyCursor()).toBe(cursorAtEntry);
    expect(engine.get("visits")).toBe(0);
    expect((engine.get(SYS.body) as { name: string }).name).toBe("hall");
  });

  it("say 之后仍可继续提交非等待类 op（对话期间状态照写）", () => {
    const { engine } = makeEngine();
    engine.submitSceneOps([{ op: "say", text: "组件说话" }]);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    // 等待态下再提交：scene 模式没有等待态要求，也不算失败
    const ok = engine.submitSceneOps([{ op: "set", key: "visits", value: 3 }]);
    expect(ok).toBe(true);
    expect(engine.get("visits")).toBe(3);
    expect(engine.get(SYS.waiting)).toBe("dialog");
  });

  it("runElementOps 在同样位置仍拒绝 say（两个入口不混用）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.runElementOps([{ op: "say", text: "不该执行" }])).toBe(false);
    expect(engine.get(SYS.waiting)).toBe("none");
    expect(errorCodes(errors)).toContain("element-ops-blocked-op");
  });
});
