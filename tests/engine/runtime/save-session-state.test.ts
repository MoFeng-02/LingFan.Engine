/**
 * 会话态键不进存档（`SESSION_STATE_KEYS`）。
 *
 * 这类键描述「引擎此刻在干什么」而不是「故事进行到哪」：正停着（`__paused`）、
 * 正停在菜单里（`__menu_return`）、正在重放（`__rollback_active`）。读档 = 会话重开，
 * 把它们写进档会让引擎一开局就停在暂停中——`advance` 直接 `pause-active`，
 * 而玩家看到的画面明明已经在等待点上了。
 *
 * 快照不经过滤：回溯要恢复的正是当时的会话态。
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveDataV1, SaveMode, SlotSummary } from "@lingfan-engine/core";
import {
  SESSION_STATE_KEYS,
  SYS,
  StoryEngine,
  parseStory,
} from "@lingfan-engine/core";

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

  /** 直接塞一份原始载荷（造旧档用） */
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

function column(id: string, commands: object[], type?: string): object {
  return type === undefined
    ? { id, kind: "flow", commands }
    : { id, kind: "flow", type, commands };
}

function say(text: string): object {
  return { op: "say", text };
}

const PAUSE_SAFE_COLUMN = column("a", [
  { op: "let", key: "x", value: 5 },
  say("一 {x}"),
  { op: "save", slot: "slot_1" },
  say("二 {x}"),
  say("三"),
]);

describe("会话态键不进存档", () => {
  it("暂停中存档：档里没有 `__paused`", async () => {
    const h = makeHarness([PAUSE_SAFE_COLUMN]);
    h.engine.start();
    h.engine.pause();
    expect(h.engine.paused()).toBe(true);
    h.engine.advance(); // 暂停中推进被拒
    expect(h.errors).toContain("pause-active");
    expect(h.engine.save("slot_1")).toBe(true);
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const keys = h.port.writes[0]!.data.state.map((entry) => entry[0]);
    expect(keys).not.toContain(SYS.paused);
    // 同一份档里该有的东西一个不少
    expect(keys).toContain(SYS.currentDialogText);
    expect(keys).toContain(SYS.waiting);
  });

  it("暂停中存档后读档：不再停在暂停态，推进照常", async () => {
    const writer = makeHarness([PAUSE_SAFE_COLUMN]);
    writer.engine.start();
    writer.engine.pause();
    writer.engine.save("slot_1");
    await vi.waitFor(() => expect(writer.port.writes.length).toBe(1));
    const payload = JSON.stringify(writer.port.writes[0]!.data);
    writer.dispose();

    const h = makeHarness([PAUSE_SAFE_COLUMN]);
    h.port.seed("slot_1", payload);
    h.engine.start();
    h.engine.load("slot_1");
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("一 5"),
    );
    expect(h.engine.paused()).toBe(false);
    h.engine.advance();
    expect(h.errors).not.toContain("pause-active");
    h.engine.advance();
    expect(h.errors).not.toContain("pause-active");
  });

  it("旧档里带着 `__paused`：读档把它丢掉，不残留暂停态", async () => {
    const h = makeHarness([PAUSE_SAFE_COLUMN]);
    h.port.seed(
      "old",
      JSON.stringify({
        formatVersion: 1,
        storyId: "t",
        coord: { columnId: "a", index: 1 },
        state: [
          [SYS.currentDialogText, "一 5"],
          [SYS.waiting, "say"],
          [SYS.paused, true],
        ],
        rngState: 1,
        functions: [],
        cursor: 0,
        history: [],
      }),
    );
    h.engine.start();
    h.engine.load("old");
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("一 5"),
    );
    expect(h.engine.paused()).toBe(false);
    h.engine.advance();
    expect(h.errors).not.toContain("pause-active");
  });

  it("档内历史检查点也不带会话态键（旧档可能留着）", async () => {
    // 这条列里没有 save 命令：档只由下面的 engine.save 产生，写入计数才是 1
    const h = makeHarness([
      column("a", [
        { op: "let", key: "x", value: 5 },
        say("一 {x}"),
        say("二 {x}"),
        say("三"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance(); // 建立历史检查点
    h.engine.pause();
    h.engine.save("slot_1");
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const history = h.port.writes[0]!.data.history;
    expect(history.length).toBeGreaterThan(0); // 没有检查点就等于空断言，先证明确实有
    for (const checkpoint of history) {
      const keys = checkpoint.state.map((entry) => entry[0]);
      expect(keys).not.toContain(SYS.paused);
    }
  });

  it("会话态键集合只含那三个键（其余 `__` 键照旧随档）", () => {
    expect([...SESSION_STATE_KEYS].sort()).toEqual(
      [SYS.paused, SYS.menuReturn, SYS.rollbackActive].sort(),
    );
    // 反例：音频暂停记账是故事态（读档到暂停期间仍要能恢复），必须随档
    expect(SESSION_STATE_KEYS.has(SYS.audioPaused)).toBe(false);
  });

  it("菜单里存档：`__menu_return` 不进档（否则读档后以为仍在菜单里）", async () => {
    // 菜单列里不放 save 命令：这一例要验的是「在菜单里点存档」这条路径，
    // 落档只该发生一次（由下面的 engine.save 触发）。
    const h = makeHarness([
      column("a", [{ op: "navigate", path: "menu" }]),
      column("menu", [say("菜单"), say("菜单二")], "ui"),
    ]);
    h.engine.start();
    h.engine.advance(); // 进菜单
    expect(h.engine.get(SYS.menuReturn)).not.toBeUndefined();
    expect(h.engine.save("slot_1")).toBe(true);
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    const keys = saved.state.map((entry) => entry[0]);
    expect(keys).not.toContain(SYS.menuReturn);
    // 坐标仍然是菜单前那个游戏点
    expect(saved.coord.columnId).toBe("a");
  });
});
