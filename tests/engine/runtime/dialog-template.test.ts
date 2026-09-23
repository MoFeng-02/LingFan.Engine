/**
 * 08 §四.5 对话框模板测试（核心层：模板名三级优先级语义，老引擎 Phase 65 同构）。
 * 锚点：
 * - template-priority（say template > character screen > null 全局默认）
 * - template-fail-closed（非字符串/空串拒绝且状态原样）
 * - template-replay-snapshot（模板名进快照：回溯/前进后随检查点恢复）
 * 拟态用户：说话→换模板→回溯→前进→menu→choose 的完整交互序列。
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

function makeHarness(
  columns: object[],
  entry = "a",
): {
  engine: StoryEngine;
  errors: string[];
  dispose: () => void;
} {
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry, columns }),
  );
  const errors: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  return {
    engine,
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function say(text: string, extra: Record<string, unknown> = {}): object {
  return { op: "say", text, ...extra };
}

describe("08 §四.5 模板三级优先级（锚点: template-priority）", () => {
  it("say.template 最优先；无 template 回角色 screen；再回 null 全局默认", () => {
    const h = makeHarness([
      column("a", [
        { op: "character", key: "少女", screen: "char-screen" },
        say("你好", { template: "custom", speaker: "少女" }),
        say("再见", { speaker: "少女" }), // 无 template → 角色 screen
        say("旁白"), // 无 template 无 speaker → null
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogTemplate)).toBe("custom");
    h.engine.advance();
    expect(h.engine.get(SYS.dialogTemplate)).toBe("char-screen");
    h.engine.advance();
    expect(h.engine.get(SYS.dialogTemplate)).toBeNull();
    h.dispose();
  });

  it("character screen 次之（说话人查表）", () => {
    const h = makeHarness([
      column("a", [
        { op: "character", key: "旁白员", screen: "nvl-screen" },
        say("……", { speaker: "旁白员" }),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogTemplate)).toBe("nvl-screen");
    h.dispose();
  });

  it("未注册说话人：无 template 无 screen → null（全局默认）", () => {
    const h = makeHarness([column("a", [say("独白")])]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogTemplate)).toBeNull();
    h.dispose();
  });
});

describe("08 §四.5 fail-closed（锚点: template-fail-closed）", () => {
  it("template 空串拒绝：engine.error 且状态原样（不写入、不停在半态）", () => {
    const h = makeHarness([
      column("a", [say("x", { template: "" }), say("y", { template: "ok" })]),
    ]);
    h.engine.start();
    expect(h.errors).toContain("say-invalid-template");
    expect(h.engine.get(SYS.dialogTemplate)).toBeUndefined(); // 拒绝句未写入
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined(); // 拒绝句未上屏
    expect(h.engine.get(SYS.waiting)).toBeUndefined(); // 未进入等待
    h.dispose();
  });

  it("template 非字符串拒绝", () => {
    const h = makeHarness([column("a", [say("x", { template: 42 })])]);
    h.engine.start();
    expect(h.errors).toContain("say-invalid-template");
    h.dispose();
  });

  it("character.screen 非字符串忽略（宽松收窄，不炸注册）", () => {
    const h = makeHarness([
      column("a", [
        { op: "character", key: "a", screen: 123 },
        say("x", { speaker: "a" }),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogTemplate)).toBeNull();
    h.dispose();
  });
});

describe("08 §四.5 拟态用户旅程 + 重放（锚点: template-replay-snapshot）", () => {
  it("说话→换模板→回溯→前进：模板名随快照恢复", () => {
    const h = makeHarness([
      column("a", [
        say("首句", { template: "bubble" }),
        say("特殊句", { template: "center" }),
        say("尾句"),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogTemplate)).toBe("bubble");
    h.engine.advance(); // 特殊句上屏
    expect(h.engine.get(SYS.dialogTemplate)).toBe("center");
    h.engine.back(); // 回首句检查点 → 重放 say → 模板名随快照恢复
    expect(h.engine.get(SYS.currentDialogText)).toBe("首句");
    expect(h.engine.get(SYS.dialogTemplate)).toBe("bubble");
    h.engine.forward(); // 沿时间线前进到特殊句站（重放）
    expect(h.engine.get(SYS.currentDialogText)).toBe("特殊句");
    expect(h.engine.get(SYS.dialogTemplate)).toBe("center");
    h.dispose();
  });

  it("menu/choose 交错：模板键保持最后 say 值，新 say 覆盖", () => {
    const h = makeHarness([
      column("a", [
        say("前句", { template: "t1" }),
        { op: "menu", options: [{ text: "甲", target: "b" }] },
      ]),
      column("b", [say("乙")]),
    ]);
    h.engine.start();
    h.engine.advance(); // menu 等待
    expect(h.engine.get(SYS.waiting)).toBe("menu");
    expect(h.engine.get(SYS.dialogTemplate)).toBe("t1"); // menu 不清模板键（老引擎同语义）
    h.engine.choose("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(h.engine.get(SYS.dialogTemplate)).toBeNull(); // 新句无模板无角色 → null
    h.dispose();
  });
});
