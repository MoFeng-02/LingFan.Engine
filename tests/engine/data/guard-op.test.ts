/**
 * guard op 五类测试（2026-10-06 · 设计稿 §8.2 语义契约逐条对应）：
 * 运行期守卫（组合根注册制）——签名 `(ctx, args)`、ctx 沙箱面（get/fail，契约只增）、
 * args 纯数据、失败 = engine.error + 状态原样 + 停在当前命令、回溯重放同判。
 */
import { describe, expect, it } from "vitest";
import type { GuardContext, OutboundEvent } from "@lingfan/engine";
import {
  SYS,
  StoryEngine,
  generateText,
  parseStory,
  parseTextStory,
  type EngineOptions,
} from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  dispose: () => void;
}

function makeEngine(
  columns: object[],
  options?: EngineOptions,
  entry = "a",
): Harness {
  const errors: OutboundEvent[] = [];
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry, columns }),
    options,
  );
  const off = engine.onEvent((e) => errors.push(e));
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

function say(text: string): object {
  return { op: "say", text };
}

function lastError(h: Harness): { code?: string; message?: string } {
  const last = h.errors.at(-1);
  if (last === undefined || last.payload.kind !== "engine.error") return {};
  const p = last.payload as { code: string; message: string };
  return { code: p.code, message: p.message };
}

describe("guard · 注册与未注册（fail-closed 口径）", () => {
  it("🔴 未注册名 ⇒ guard-unknown（停在当前命令，状态原样）", () => {
    const h = makeEngine([
      column("a", [{ op: "guard", fn: "不存在" }, { op: "say", text: "不可达" }]),
    ]);
    h.engine.start();
    expect(lastError(h)).toMatchObject({ code: "guard-unknown" });
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined();
    h.dispose();
  });

  it("🔴 未注入 guards（缺省 {}）⇒ 同口径 guard-unknown", () => {
    const h = makeEngine([column("a", [{ op: "guard", fn: "any" }])]);
    h.engine.start();
    expect(lastError(h).code).toBe("guard-unknown");
    h.dispose();
  });
});

describe("guard · ctx 沙箱面与 args（签名 (ctx, args)）", () => {
  it("🔴 ctx.get 读 SSOT；args 纯数据透传；通过 = 纯推进", () => {
    const seen: { ctxKeys: string[]; args: unknown } = { ctxKeys: [], args: undefined };
    const h = makeEngine(
      [
        column("a", [
          { op: "set", key: "player.gold", value: 30 },
          { op: "guard", fn: "check", args: { min: 25, tag: "金币校验" } },
          { op: "say", text: "通过" },
        ]),
      ],
      {
        guards: {
          check: (ctx: GuardContext, args: Record<string, unknown>) => {
            const gold = ctx.get("player.gold");
            if (typeof gold !== "number" || gold < (args?.["min"] as number))
              ctx.fail(`金币不足：${String(gold)}`);
            seen.ctxKeys.push(`gold=${String(gold)}`);
            seen.args = args;
          },
        },
      },
    );
    h.engine.start();
    expect(seen).toMatchObject({ ctxKeys: ["gold=30"], args: { min: 25, tag: "金币校验" } });
    // 通过 = 纯推进：后续 say 上屏，零 engine.error
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("通过");
    expect(lastError(h).code).toBeUndefined();
    h.dispose();
  });

  it("🔴 ctx.fail ⇒ guard-failed + 自定义消息 + 状态原样 + 停在当前命令", () => {
    const h = makeEngine(
      [
        column("a", [
          { op: "set", key: "player.gold", value: 7 },
          { op: "guard", fn: "check", args: { min: 25 } },
          { op: "say", text: "不可达" },
        ]),
      ],
      {
        guards: {
          check: (ctx: GuardContext, args: Record<string, unknown>) => {
            const gold = ctx.get("player.gold");
            if (typeof gold !== "number" || gold < (args?.["min"] as number))
              ctx.fail(`金币不足：${String(gold)} < ${String(args?.["min"])}`);
          },
        },
      },
    );
    h.engine.start();
    expect(lastError(h)).toMatchObject({ code: "guard-failed" });
    expect(lastError(h).message).toContain("7 < 25");
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined();
    h.dispose();
  });

  it("🔴 守卫抛出非 fail 异常 ⇒ guard-threw 兜底（不静默、不裸崩）", () => {
    const h = makeEngine(
      [column("a", [{ op: "guard", fn: "boom" }])],
      { guards: { boom: () => { throw new TypeError("逻辑炸了"); } } },
    );
    h.engine.start();
    expect(lastError(h)).toMatchObject({ code: "guard-threw" });
    expect(lastError(h).message).toContain("逻辑炸了");
    h.dispose();
  });

  it("🔴 args 非 JSON 安全（数组内函数——stringify 语义拒收）⇒ guard-args-unsafe fail-closed", () => {
    const h = makeEngine(
      [column("a", [{ op: "guard", fn: "check", args: { history: [() => 1] } } as never])],
      { guards: { check: () => undefined } },
    );
    h.engine.start();
    expect(lastError(h).code).toBe("guard-args-unsafe");
    h.dispose();
  });
});

describe("guard · 回溯重放同判（纯函数语义）", () => {
  it("🔴 回退到 guard 前再前进 ⇒ 同位同判（再次拦截）", () => {
    const 偏置 = 0; // 模拟「同一守卫、状态决定结果」——重放时状态由快照恢复 ⇒ 同判（此变量即守卫的外部闭包输入，重放期不变）
    const h = makeEngine(
      [
        column("a", [
          { op: "say", text: "检查点句" },
          { op: "guard", fn: "check" },
          { op: "say", text: "不可达" },
        ]),
      ],
      {
        guards: {
          check: (ctx: GuardContext) => {
            const gold = ctx.get("player.gold");
            if ((typeof gold === "number" ? gold : 0) + 偏置 < 25) ctx.fail("金币不足");
          },
        },
      },
    );
    h.engine.start();
    h.engine.advance(); // 上屏检查点句
    expect(lastError(h).code).toBe("guard-failed"); // 拦截（gold=7）
    h.engine.back(); // 回检查点句
    expect(h.engine.get(SYS.currentDialogText)).toBe("检查点句");
    h.engine.advance(); // 前进重放（偏置未变）⇒ 同判
    expect(lastError(h).code).toBe("guard-failed");
    h.dispose();
  });
});

describe("guard · 文本投影往返", () => {
  it("generateText 产出 guard 行（含 JSON 参数）；parseTextStory 回读命令深等", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        column("a", [
          { op: "guard", fn: "inventory-consistent" },
          { op: "guard", fn: "check", args: { maxSlots: 8, tag: "背包" } },
          say("尾"),
        ]),
      ],
    });
    const text = generateText(story);
    expect(text).toContain('guard "inventory-consistent"');
    // args = 裸 JSON 字面量（JSON.stringify 插入序、零空格）
    expect(text).toContain('guard "check" {"maxSlots":8,"tag":"背包"}');
    const reparsed = parseTextStory(text);
    expect(reparsed.columns[0]?.commands).toEqual(story.columns[0]?.commands);
  });
});

describe("guard · 契约校验（format 层 fail-closed）", () => {
  it("缺 fn / args 非对象 ⇒ issue", () => {
    expect(() =>
      parseStory({ formatVersion: 1, id: "t", entry: "a", columns: [column("a", [{ op: "guard" }])] }),
    ).toThrow(/fn/);
    expect(() =>
      parseStory(
        { formatVersion: 1, id: "t", entry: "a", columns: [column("a", [{ op: "guard", fn: "x", args: "nope" }])] },
      ),
    ).toThrow(/args/);
  });
});
