/**
 * 对话字体测试（核心层：字体分辨链语义，与说话人颜色/模板三级同构）。
 * - 四级分辨链（say font > character font > 列级 font > 空串=无声明，回落宿主项目默认）
 * - fail-closed（非字符串/空串拒绝且状态原样）
 * - 字体名进快照：回溯/前进后随检查点恢复；换列/菜单后新句重算不残留
 * 拟态用户：说话→换字体→回溯→前进→menu 的完整交互序列。
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

function column(id: string, commands: object[], extra: Record<string, unknown> = {}): object {
  return { id, kind: "flow", ...extra, commands };
}

function say(text: string, extra: Record<string, unknown> = {}): object {
  return { op: "say", text, ...extra };
}

describe("字体四级分辨链", () => {
  it("say.font 最优先；无 font 回角色 font；换列后回列级 font；全无 → 空串", () => {
    const h = makeHarness([
      column("a", [
        { op: "character", key: "少女", font: "角色字体" },
        say("你好", { font: "楷体", speaker: "少女" }),
        say("再见", { speaker: "少女" }), // 无 font → 角色 font
        { op: "jump", target: "b" },
      ]),
      column("b", [say("尾句")], { font: "列字体" }),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogFont)).toBe("楷体");
    h.engine.advance();
    expect(h.engine.get(SYS.dialogFont)).toBe("角色字体");
    h.engine.advance(); // a 列走完 jump 进 b 列：无 font 无角色 → 列级 font
    expect(h.engine.get(SYS.dialogFont)).toBe("列字体");
    h.dispose();
  });

  it("无角色无列声明 → 空串（空串=无声明，宿主回落项目默认字体）", () => {
    const h = makeHarness([column("a", [say("独白")])]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogFont)).toBe("");
    h.dispose();
  });

  it("说话人颜色与字体互不干扰（同句双覆盖各自落位）", () => {
    const h = makeHarness([
      column("a", [say("你好", { font: "楷体", color: "#888" })]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogFont)).toBe("楷体");
    expect(h.engine.get(SYS.currentDialogColor)).toBe("#888");
    h.dispose();
  });
});

describe("fail-closed", () => {
  it("font 空串拒绝：engine.error 且状态原样（不写入、不停在半态）", () => {
    const h = makeHarness([
      column("a", [say("x", { font: "" }), say("y", { font: "楷体" })]),
    ]);
    h.engine.start();
    expect(h.errors).toContain("say-invalid-font");
    expect(h.engine.get(SYS.dialogFont)).toBeUndefined(); // 拒绝句未写入
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined(); // 拒绝句未上屏
    expect(h.engine.get(SYS.waiting)).toBeUndefined(); // 未进入等待
    h.dispose();
  });

  it("font 非字符串拒绝", () => {
    const h = makeHarness([column("a", [say("x", { font: 42 })])]);
    h.engine.start();
    expect(h.errors).toContain("say-invalid-font");
    h.dispose();
  });

  it("character.font 非字符串忽略（宽松收窄，注册不受影响）", () => {
    const h = makeHarness([
      column("a", [
        { op: "character", key: "a", font: 123 },
        say("x", { speaker: "a" }),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogFont)).toBe("");
    h.dispose();
  });
});

describe("拟态用户旅程 + 重放", () => {
  it("说话→换字体→回溯→前进：字体随快照恢复", () => {
    const h = makeHarness([
      column("a", [
        say("首句", { font: "楷体" }),
        say("特殊句", { font: "黑体" }),
        say("尾句"),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogFont)).toBe("楷体");
    h.engine.advance(); // 特殊句上屏
    expect(h.engine.get(SYS.dialogFont)).toBe("黑体");
    h.engine.back(); // 回首句检查点 → 重放 say → 字体随快照恢复
    expect(h.engine.get(SYS.currentDialogText)).toBe("首句");
    expect(h.engine.get(SYS.dialogFont)).toBe("楷体");
    h.engine.forward(); // 沿时间线前进到特殊句站（重放）
    expect(h.engine.get(SYS.currentDialogText)).toBe("特殊句");
    expect(h.engine.get(SYS.dialogFont)).toBe("黑体");
    h.dispose();
  });

  it("menu/choose 换列：菜单与换列都重算分辨链，上一句字体不残留", () => {
    const h = makeHarness([
      column("a", [
        say("前句", { font: "楷体" }),
        { op: "menu", options: [{ text: "甲", target: "b" }] },
      ]),
      column("b", [say("乙")], { font: "列字体" }),
    ]);
    h.engine.start();
    h.engine.advance(); // menu 等待
    expect(h.engine.get(SYS.waiting)).toBe("menu");
    expect(h.engine.get(SYS.dialogFont)).toBe(""); // menu 同清（与 currentDialogColor 同口径）
    h.engine.choose("b");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    expect(h.engine.get(SYS.dialogFont)).toBe("列字体"); // 新句按新列重算
    h.dispose();
  });
});
