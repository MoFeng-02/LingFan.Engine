/**
 * 回溯到「档内检查点」时也要能恢复列级作用域。
 *
 * 读档后会从档里重建历史检查点。这些检查点若不带列级作用域，回溯到它们
 * 就和修复前的读档一样：列级 `let` 消失，`{变量}` 插值失败、舞台上显示原文。
 * 所以档里**每个**检查点各存一份列级层——回溯目标可以是档内任何一步。
 *
 * 本会话内的检查点不走这条路径：它们由 `takeSnapshot` 直接存帧栈深拷贝。
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveDataV1, SaveMode, SlotSummary } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

class MemorySavePort {
  readonly writes: { slot: string; data: SaveDataV1; mode: SaveMode }[] = [];
  private readonly slots = new Map<string, string>();

  async write(slot: string, payload: string, mode: SaveMode): Promise<void> {
    this.writes.push({ slot, data: JSON.parse(payload) as SaveDataV1, mode });
    this.slots.set(slot, payload);
  }

  async read(slot: string): Promise<string> {
    const raw = this.slots.get(slot);
    if (raw === undefined) throw new Error(`槽位不存在：${slot}`);
    return raw;
  }

  async remove(slot: string): Promise<void> {
    this.slots.delete(slot);
  }

  async list(): Promise<SlotSummary[]> {
    return [...this.slots.keys()].map((slot) => ({
      slot,
      saveCount: 1,
      timestamp: 0,
      mode: "machine-bound",
    }));
  }

  seed(slot: string, payload: string): void {
    this.slots.set(slot, payload);
  }
}

interface Harness {
  engine: StoryEngine;
  port: MemorySavePort;
  errors: string[];
  dispose: () => void;
}

function makeHarness(columns: object[]): Harness {
  const port = new MemorySavePort();
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry: "a", columns }),
    { savePort: port },
  );
  const errors: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  return {
    engine,
    port,
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

/** 列级 `let` 在四句台词之间演化，便于分辨回溯到了哪一步 */
const COLUMN = column("a", [
  { op: "let", key: "a", value: 100 },
  say("{a} 我是值"),
  { op: "let", key: "a", value: "*= {2}" },
  say("{a} 我是乘值"),
  { op: "let", key: "a", value: "+= {1}" },
  say("{a} 我是加值"),
  say("结束"),
]);

describe("回溯恢复列级作用域", () => {
  it("本会话内的回溯：列级 let 由检查点自带的帧栈恢复", async () => {
    const h = makeHarness([COLUMN]);
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("100 我是值");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("200 我是乘值");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("201 我是加值");
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("200 我是乘值");
    expect(h.errors).not.toContain("unknown-variable");
    h.dispose();
  });

  it("读档后的回溯：档内检查点各带一份列级作用域", async () => {
    const writer = makeHarness([COLUMN]);
    writer.engine.start();
    writer.engine.advance();
    writer.engine.advance();
    // 在「201 我是加值」等待点存档
    expect(writer.engine.save("slot_1")).toBe(true);
    await vi.waitFor(() => expect(writer.port.writes.length).toBe(1));
    const saved = writer.port.writes[0]!.data;
    writer.dispose();

    // 档内每个检查点都带列级层（本列一直有 `a`）
    expect(saved.history.length).toBeGreaterThan(1);
    for (const checkpoint of saved.history) {
      expect(checkpoint.scope).toEqual([["a", expect.any(Number)]]);
    }

    const h = makeHarness([COLUMN]);
    h.port.seed("slot_1", JSON.stringify(saved));
    h.engine.start();
    h.engine.load("slot_1");
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("201 我是加值"),
    );
    // 回溯到档内更早的一步：那一步的列级 `a` 必须是当时的 200，不是字面量
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("200 我是乘值");
    expect(h.errors).not.toContain("unknown-variable");
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("100 我是值");
    expect(h.errors).not.toContain("unknown-variable");
    h.dispose();
  });

  it("旧档的检查点没有 scope 字段：按空层重建，不报格式错", async () => {
    const h = makeHarness([column("a", [say("一"), say("二"), say("三")])]);
    h.port.seed(
      "old",
      JSON.stringify({
        formatVersion: 1,
        storyId: "t",
        coord: { columnId: "a", index: 1 },
        state: [
          [SYS.currentDialogText, "二"],
          [SYS.waiting, "say"],
        ],
        rngState: 1,
        functions: [],
        cursor: 0,
        history: [
          {
            coord: { columnId: "a", index: 0 },
            state: [
              [SYS.currentDialogText, "一"],
              [SYS.waiting, "say"],
            ],
            rngState: 1,
          },
        ],
      }),
    );
    h.engine.start();
    h.engine.load("old");
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("二"),
    );
    h.engine.back();
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    expect(h.errors).not.toContain("save-format");
    h.dispose();
  });

  it("块级 let 在档内检查点上靠重放重建（不进检查点的 scope）", async () => {
    const h = makeHarness([
      column("a", [
        { op: "let", key: "outer", value: 9 },
        say("外 {outer}"),
        {
          op: "if",
          cond: "true",
          then: [
            { op: "let", key: "inner", value: 7 },
            say("内 {inner}"),
            say("内二 {inner}"),
          ],
        },
        say("尾"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("内 7");
    h.engine.save("slot_1");
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    // 档尾坐标落在块内 ⇒ 列级层里只有 outer，没有块级 inner
    expect(saved.scope).toEqual([["outer", 9]]);
    // 建档时的历史检查点同理：只要列级层
    for (const checkpoint of saved.history) {
      const keys = (checkpoint.scope ?? []).map((entry) => entry[0]);
      expect(keys).not.toContain("inner");
    }
    h.dispose();
  });
});
