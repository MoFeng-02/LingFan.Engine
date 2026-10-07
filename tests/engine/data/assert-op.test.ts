/**
 * assert op 五类测试：fail-closed 拦截语义。
 *
 * 语义：cond 执行期求值——真 = 纯推进；假 = `engine.error`（assert-failed）+
 * **停在当前命令**（状态原样 + 阻止推进）。无系统键副作用（键序列零冲突）。
 * 覆盖：契约校验 / 运行期拦截 / 表达式联动 / 回溯重放同判 / 文本投影往返。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "@lingfan/engine";
import { SYS, StoryEngine, generateText, parseStory, parseTextStory } from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
      engine.dispose();
    },
  };
}

function makeEngine(columns: object[], entry = "a", defines?: Record<string, unknown>): Harness {
  return instrument(
    new StoryEngine(
      parseStory({ formatVersion: 1, id: "t", entry, columns, ...(defines === undefined ? {} : { defines }) }),
    ),
  );
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function say(text: string): object {
  return { op: "say", text };
}

function lastError(h: Harness): { code?: string; message?: string } {
  const last = h.errors.at(-1);
  if (last === undefined || last.payload.kind !== "engine.error") return {};
  const p = last.payload as { code: string; message: string };
  return { code: p.code, message: p.message };
}

describe("assert · 契约校验（format 层 fail-closed）", () => {
  it("缺 cond / 空 cond ⇒ issue", () => {
    expect(() =>
      parseStory({ formatVersion: 1, id: "t", entry: "a", columns: [column("a", [{ op: "assert" }])] },
    )).toThrow(/cond/);
    expect(() =>
      parseStory(
        { formatVersion: 1, id: "t", entry: "a", columns: [column("a", [{ op: "assert", cond: "" }])] },
      ),
    ).toThrow(/cond/);
  });

  it("message 非字符串 ⇒ issue", () => {
    expect(() =>
      parseStory(
        { formatVersion: 1, id: "t", entry: "a", columns: [column("a", [{ op: "assert", cond: "{1}", message: 3 }])] },
      ),
    ).toThrow(/message/);
  });
});

describe("assert · 运行期拦截语义", () => {
  it("通过 ⇒ 纯推进（后续 say 上屏，零系统键副作用）", () => {
    const h = makeEngine([
      column("a", [{ op: "assert", cond: "{1 == 1}" }, say("通过")]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("通过");
    expect(lastError(h).code).toBeUndefined();
    h.dispose();
  });

  it("失败 ⇒ engine.error(assert-failed) + 自定义 message + **停在当前命令**（状态原样 + 阻止推进）", () => {
    const h = makeEngine([column("a", [{ op: "assert", cond: "{1 > 2}", message: "数学崩坏了" }, say("不应到达")])]);
    h.engine.start();
    expect(lastError(h)).toMatchObject({ code: "assert-failed" });
    expect(lastError(h).message).toContain("数学崩坏了");
    // 状态原样：后续 say 未上屏；无waiting（引擎停在命令位而非等待态）
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined();
    expect(h.engine.get(SYS.waiting)).toBeUndefined();
    // 阻止推进：再次推进 ⇒ advance-invalid（停在命令位、无可推进之物——语义即「拦在原地」）
    h.errors.length = 0;
    h.engine.advance();
    expect(lastError(h).code).toBe("advance-invalid");
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined();
    h.dispose();
  });

  it("失败且无 message ⇒ 兜底文案携带 cond 原文（不吞信息）", () => {
    // cond 必须是**可求值**的假条件——未定义变量会先走表达式错误（unknown-variable），
    //    轮不到断言判定（错误优先级：表达式错误 > 断言失败）
    const h = makeEngine([column("a", [{ op: "assert", cond: "{2 > 3}" }])]);
    h.engine.start();
    expect(lastError(h).code).toBe("assert-failed");
    expect(lastError(h).message).toContain("2 > 3");
    h.dispose();
  });

  it("表达式联动 defines：真值通过 / 假值拦截（执行期求值）", () => {
    const pass = makeEngine(
      [column("a", [{ op: "assert", cond: "{player.gold >= 25}" }, say("过")])],
      "a",
      { "player.gold": 30 },
    );
    pass.engine.start(); // assert 纯推进 ⇒ say("过") 等待中
    expect(pass.engine.get(SYS.currentDialogText)).toBe("过");
    pass.dispose();

    const block = makeEngine(
      [column("a", [{ op: "assert", cond: "{player.gold >= 25}" }])],
      "a",
      { "player.gold": 7 },
    );
    block.engine.start();
    expect(lastError(block).code).toBe("assert-failed");
    block.dispose();
  });

  it("回溯安全：回退到 assert 前再前进 ⇒ **同位同判**（再次拦截）", () => {
    const h = makeEngine([
      column("a", [
        say("检查点句"),
        { op: "assert", cond: "{1 > 2}", message: "必拦" },
        say("不可达"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance(); // 上屏检查点句（建检查点）
    expect(lastError(h).code).toBe("assert-failed"); // 拦截
    h.engine.back(); // 回到检查点句
    expect(h.engine.get(SYS.currentDialogText)).toBe("检查点句");
    h.engine.advance(); // 前进重放 → 同位同判：再次拦截
    expect(lastError(h).code).toBe("assert-failed");
    expect(h.engine.get(SYS.currentDialogText)).toBe("检查点句");
    h.dispose();
  });
});

describe("assert · 文本投影往返", () => {
  it("generateText 产出 assert 行；parseTextStory 回读命令深等", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        column("a", [
          { op: "assert", cond: "{player.gold >= 25}", message: "金币不足" },
          { op: "assert", cond: "{story.ready}" },
          say("尾"),
        ]),
      ],
    });
    const text = generateText(story); // 直接返回字符串（非 {text} 对象）
    expect(text).toContain("assert {player.gold >= 25} ");
    expect(text).toContain('"金币不足"');
    expect(text).toContain("assert {story.ready}");
    const reparsed = parseTextStory(text);
    expect(reparsed.columns[0]?.commands).toEqual(story.columns[0]?.commands);
  });
});
