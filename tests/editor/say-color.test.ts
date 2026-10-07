/**
 * `say color`（说话人颜色覆盖）守卫。
 *
 * **澄清概念**（容易混淆）：
 * - **行内标记** `say "...{color=#FFD700}秘密{/color}..."` —— 写在**文本内部**，
 *   标记某一段文字的颜色。**一直在生效**（看到「变色」就是它）。
 * - **命令参数** `say "..." color="#888888"` —— 写在**命令上**，
 *   覆盖**整句/说话人**的颜色。
 *
 * 本文件锁的是**后者**。四层都要通：
 * ① 投影（DSL 文本 → 命令）② 运行期（写 `SYS.currentDialogColor`）
 * ③ 校验（编辑器 schema 与引擎**同一判据**）④ 不残留（每句必写，缺省空串）
 */
import { describe, expect, it } from "vitest";
import {
  SYS,
  StoryEngine,
  isValidSayColor,
  parseStory,
  parseTextStory,
  type OutboundEvent,
} from "@lingfan/engine";
import { validateCommand } from "../../packages/editor/src/schema/opSchemas";

function instrument(engine: StoryEngine) {
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => errors.push(e));
  return { engine, errors, dispose: off };
}

function storyWithSay(cmds: object[]) {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [{ id: "a", kind: "flow", commands: cmds }],
  });
}

describe("say color · 校验判据（**引擎导出，编辑器复用**）", () => {
  it("接受 hex 颜色三种长度", () => {
    expect(isValidSayColor("#888")).toBe(true);
    expect(isValidSayColor("#FFD700")).toBe(true);
    expect(isValidSayColor("#FFD700CC")).toBe(true);
    expect(isValidSayColor("#ffd700")).toBe(true); // 大小写不敏感
  });

  it("拒绝非 hex（**fail-closed**，不静默失效）", () => {
    expect(isValidSayColor("red")).toBe(false); // 命名色
    expect(isValidSayColor("rgb(1,2,3)")).toBe(false);
    expect(isValidSayColor("FFD700")).toBe(false); // 缺 #
    expect(isValidSayColor("")).toBe(false);
    expect(isValidSayColor("#FFFF")).toBe(false); // 非法长度
  });

  it("**编辑器 schema 与引擎同一判据**（合法值两边都过）", () => {
    expect(validateCommand({ op: "say", text: "x", color: "#FFD700" })).toEqual([]);
  });

  it("**编辑器 schema 拒绝非法颜色**（两层不会一个过一个拒）", () => {
    const issues = validateCommand({ op: "say", text: "x", color: "red" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain("十六进制");
  });
});

describe("say color · 投影（DSL 文本 → 命令）", () => {
  it("**投影出 color 字段**（不再只是「接受但忽略」）", () => {
    const story = parseTextStory('label a:\n  say "（第一章完）" speaker="narrator" color="#888888"');
    const cmd = story.columns[0]?.commands?.[0];
    expect(cmd?.op).toBe("say");
    expect(cmd?.color).toBe("#888888");
    expect(cmd?.speaker).toBe("narrator");
  });

  it("省略 color ⇒ 命令里没有该字段（不凭空造默认值）", () => {
    const story = parseTextStory('label a:\n  say "甲"');
    const cmd = story.columns[0]?.commands?.[0];
    expect(cmd?.color).toBeUndefined();
  });

  it("**行内标记不受影响**（两者并存，各司其职）", () => {
    const story = parseTextStory('label a:\n  say "{color=#FFD700}金{/color}" color="#888888"');
    const cmd = story.columns[0]?.commands?.[0];
    // 文本里的标记原样保留（由渲染层处理）
    expect(cmd?.text).toBe("{color=#FFD700}金{/color}");
    // 命令参数独立存在
    expect(cmd?.color).toBe("#888888");
  });
});

describe("say color · 运行期（写入系统键）", () => {
  it("**执行后 `SYS.currentDialogColor` = 覆盖值**", () => {
    const h = instrument(new StoryEngine(storyWithSay([
      { op: "say", text: "（第一章完）", speaker: "旁白", color: "#888888" },
    ])));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogColor)).toBe("#888888");
    h.dispose();
  });

  it("**无 color ⇒ 空串**（无覆盖，用 character 定义的颜色）", () => {
    const h = instrument(new StoryEngine(storyWithSay([{ op: "say", text: "甲" }])));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogColor)).toBe("");
    h.dispose();
  });

  it("**每句必写 ⇒ 上一句的覆盖不残留**", () => {
    const h = instrument(new StoryEngine(storyWithSay([
      { op: "say", text: "甲", color: "#FF0000" },
      { op: "say", text: "乙" },
    ])));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogColor)).toBe("#FF0000");
    h.engine.advance();
    // 第二句没有 color ⇒ 必须清回空串（否则第一句的红色会串到第二句）
    expect(h.engine.get(SYS.currentDialogColor)).toBe("");
    h.dispose();
  });

  it("**非法颜色运行期也 fail-closed**（与校验层同口径）", () => {
    const h = instrument(new StoryEngine(storyWithSay([
      { op: "say", text: "甲", color: "red" },
    ])));
    h.engine.start();
    // 错误事件是**嵌套**形态：`{kind:"event", payload:{kind:"engine.error", code,…}}`
    const err = h.errors.find(
      (e) => (e as { payload?: { code?: string } }).payload?.code === "say-invalid-color",
    );
    expect(err, "非法 color 必须在运行期被拒").toBeDefined();
    h.dispose();
  });
});
