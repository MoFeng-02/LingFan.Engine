/**
 * 存档携带列级作用域（`SaveDataV1.scope`）。
 *
 * 修复前的缺陷：读档只恢复全局 `state`，`columnFrameAt` 用空 `Scope.root()` 重建列帧
 * 并从存档坐标重放。列级 `let` 的声明点都在那个坐标**之前**，重放走不到它们 ⇒
 * 存档点之后的 `{变量}` 插值求值失败（`unknown-variable`），舞台上原样显示 `{a}`。
 *
 * 现在的边界：
 * - **列级层随档**（`scope` 字段）：声明点在存档坐标之前，重放不会回到那些命令。
 * - **块级层不随档**：块级 `let` 的存档坐标会回退到块的控制命令，重放重入块体从头执行，
 *   按同样的代码重新声明即可重建。
 * - **旧档没有 `scope` 字段** ⇒ 按空列级层处理，不报错（存量档必须仍能读）。
 * - **档内历史检查点不带作用域**：档只存一个坐标的列级层；回溯到档前坐标按空层重建，
 *   与「档前历史本就无法完整重放」的既有边界一致。
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

  /** 直接塞一份原始载荷（造旧档、坏档用） */
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

function makeHarness(columns: object[], entry = "a"): Harness {
  const port = new MemorySavePort();
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry, columns }),
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

describe("存档携带列级作用域", () => {
  it("存档点之前声明的列级 let：读档后仍可用于插值", async () => {
    const h = makeHarness([
      column("a", [
        { op: "let", key: "a", value: 100 },
        say("{a} 我是值"),
        { op: "let", key: "a", value: "/= {2}" },
        say("{a} 我是除值"),
        { op: "save", slot: "slot_1" },
        say("{a} 存后一句"),
        say("结束"),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("100 我是值");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("50 我是除值");
    h.engine.advance(); // 「50 我是除值」解除 → save（等待点上）→ 「50 存后一句」等待
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    // 列级作用域写进档了
    expect(saved.scope).toEqual([["a", 50]]);

    h.engine.advance(); // 「结束」
    expect(h.engine.get(SYS.currentDialogText)).toBe("结束");

    expect(h.engine.load("slot_1")).toBe(true);
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("50 存后一句"),
    );
    // 修复前这里是字面量 "{a} 存后一句"，且 errors 含 unknown-variable
    expect(h.engine.get(SYS.currentDialogText)).toBe("50 存后一句");
    expect(h.errors).not.toContain("unknown-variable");
    h.dispose();
  });

  it("块级 let：不随档，靠坐标重放重入块体重建", async () => {
    const h = makeHarness([
      column("a", [
        {
          op: "if",
          cond: "true",
          then: [
            { op: "let", key: "inner", value: 7 },
            say("[{inner}] 块内"),
            { op: "save", slot: "slot_1" },
            say("[{inner}] 块内续"),
          ],
        },
        say("结束"),
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("[7] 块内");
    h.engine.advance(); // save 执行 → 「[7] 块内续」等待
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    // 块级变量不进档：这份档的 scope 字段缺席
    expect(saved.scope).toBeUndefined();

    h.engine.advance(); // 「结束」
    expect(h.engine.get(SYS.currentDialogText)).toBe("结束");

    expect(h.engine.load("slot_1")).toBe(true);
    // 块内等待点的坐标回退到块的控制命令（`if`）⇒ 重放从块体开头重新进入，
    // 所以读档后先落到块内第一句；关键断言是 `inner` 被重新声明出来了（不是字面量）。
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("[7] 块内"),
    );
    expect(h.errors).not.toContain("unknown-variable");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("[7] 块内续");
    h.dispose();
  });

  it("旧档没有 scope 字段：按空列级层读，不报错（存量档仍可读）", async () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "set", key: "n", value: 1 }, say("二")]),
    ]);
    h.engine.start();
    // 造一份修复前形状的档：无 scope 字段
    h.port.seed(
      "old",
      JSON.stringify({
        formatVersion: 1,
        storyId: "t",
        coord: { columnId: "a", index: 0 },
        state: [["n", 1]],
        rngState: 1,
        functions: [],
        cursor: 0,
        history: [],
      }),
    );
    expect(h.engine.load("old")).toBe(true);
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("一"),
    );
    expect(h.engine.get("n")).toBe(1);
    expect(h.errors).not.toContain("save-format");
    expect(h.errors).not.toContain("unknown-variable");
    h.dispose();
  });

  it("scope 形状非法：按空列级层处理，不中断读档", async () => {
    const h = makeHarness([column("a", [say("一"), say("二")])]);
    h.engine.start();
    h.port.seed(
      "bad",
      JSON.stringify({
        formatVersion: 1,
        storyId: "t",
        coord: { columnId: "a", index: 0 },
        state: [],
        rngState: 1,
        functions: [],
        cursor: 0,
        history: [],
        scope: [["ok", 1], "不是二元组"],
      }),
    );
    expect(h.engine.load("bad")).toBe(true);
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("一"),
    );
    expect(h.errors).not.toContain("save-format");
    h.dispose();
  });

  it("菜单里存档：坐标换成菜单前的游戏点，那条路径不携带作用域", async () => {
    const h = makeHarness([
      column("a", [
        { op: "let", key: "a", value: 5 },
        say("{a} 游戏内"),
        { op: "navigate", path: "menu" },
      ]),
      {
        id: "menu",
        kind: "flow",
        type: "ui",
        commands: [say("菜单"), { op: "save", slot: "slot_1" }, say("菜单二")],
      },
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("5 游戏内");
    h.engine.advance(); // 进菜单 → 「菜单」等待
    expect(h.engine.get(SYS.currentDialogText)).toBe("菜单");
    h.engine.advance(); // save 排入 → 「菜单二」等待（等待点上落档）
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    // 坐标是菜单前的游戏点（"a"，不是 "menu"）
    expect(saved.coord.columnId).toBe("a");
    // 那一列的帧已被 enterColumn 换掉 ⇒ 拿不到作用域，字段缺席
    expect(saved.scope).toBeUndefined();
    h.dispose();
  });
});
