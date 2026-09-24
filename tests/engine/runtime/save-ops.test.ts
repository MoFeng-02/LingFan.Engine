/**
 * 01 §二.3 存档类 op 测试（save / load / auto_save / save_delete）+ 02 §三.2 命令面 save/load。
 * 锚点：
 * - save-op-orchestrates-port（op → SavePort 编排；非等待命令立即继续）
 * - auto-save-on-waiting-display（等待画面建立触发；解除/重放不触发；开关系统键读档复位）
 * - load-op-teleports（op load 异步传送回档内等待点）
 * - save-delete-keeps-high-water（K4：删档不动防回档基准——Rust 侧 delete_save 同锚点）
 * - save-ops-fail-closed（无 SavePort / 槽名非法 / enabled 非布尔 → engine.error，状态原样）
 * - save-load-command-completion（命令面 save/load 完成信号 save.done/load.done：成功才发、
 *   守卫与校验失败不发；故事 save op 的等待点落档不发——信号归属命令面）
 * SavePort 为契约替身（内存实现）；Rust 侧安全校验在 cargo 侧测（save.rs），两侧各测一半。
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveDataV1, SaveMode, SlotSummary } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

interface WriteCall {
  slot: string;
  data: SaveDataV1;
  mode: SaveMode;
}

class MemorySavePort {
  readonly writes: WriteCall[] = [];
  readonly removes: string[] = [];
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
    this.removes.push(slot);
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
}

interface Harness {
  engine: StoryEngine;
  port: MemorySavePort;
  errors: string[];
  dispose: () => void;
}

function makeHarness(columns: object[], withPort = true, entry = "a"): Harness {
  const port = new MemorySavePort();
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry, columns }),
    withPort ? { savePort: port } : {},
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

describe("01 §二.3 save op（锚点: save-op-orchestrates-port）", () => {
  it("等待点写档：载荷含槽位/title/等待坐标，故事立即继续（非等待命令）", async () => {
    const h = makeHarness([
      column("a", [
        say("一"),
        { op: "save", slot: "slot_1", title: "第一章" },
        say("二"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance(); // 「一」解除 → save（等待点上）→ 「二」等待
    expect(h.engine.get(SYS.currentDialogText)).toBe("二"); // save 未阻断流程
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const w = h.port.writes[0]!;
    expect(w.slot).toBe("slot_1");
    expect(w.mode).toBe("machine-bound"); // 缺省模式
    expect(w.data.title).toBe("第一章");
    expect(w.data.coord.columnId).toBe("a");
    h.dispose();
  });

  it("无 SavePort fail-closed：engine.error 且停机（状态原样）", () => {
    const h = makeHarness(
      [column("a", [say("一"), { op: "save", slot: "slot_1" }])],
      false,
    );
    h.engine.start();
    h.engine.advance();
    expect(h.errors).toContain("save-unavailable");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a");
    h.dispose();
  });

  it("未知负载字段与非法槽名 fail-closed（E3/F5）", () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "save", slot: "../evil" }]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.errors).toContain("save-invalid-slot");
    const h2 = makeHarness([
      column("a", [say("一"), { op: "save", slot: "s", extra: 1 }]),
    ]);
    h2.engine.start();
    h2.engine.advance();
    expect(h2.errors).toContain("save-unknown-field");
    h.dispose();
    h2.dispose();
  });
});

describe("auto_save 开关（锚点: auto-save-on-waiting-display）", () => {
  it("缺省关：不写档；开启后每等待画面写 auto 槽；关闭即停（写档同步 kick）", () => {
    const h = makeHarness([
      column("a", [
        say("一"),
        { op: "auto_save", enabled: true },
        say("二"),
        say("三"),
        { op: "auto_save", enabled: false },
        say("四"),
      ]),
    ]);
    h.engine.start();
    expect(h.port.writes.length).toBe(0); // 缺省关：「一」上屏不写
    h.engine.advance(); // auto_save true → 「二」上屏 = 等待画面建立 → 写 auto 槽
    expect(h.port.writes.length).toBe(1);
    expect(h.port.writes[0]!.slot).toBe("auto");
    expect(h.port.writes[0]!.data.coord.columnId).toBe("a");
    h.engine.advance(); // 「三」上屏 → 第二次写
    expect(h.port.writes.length).toBe(2);
    h.engine.advance(); // auto_save false → 「四」上屏 → 不再写
    expect(h.engine.get(SYS.currentDialogText)).toBe("四");
    expect(h.port.writes.length).toBe(2);
    h.dispose();
  });

  it("重放期与离开画面补交均不自动存档（rollbackActive 守卫 + 消费点只在等待建立）", () => {
    const h = makeHarness([
      column("a", [{ op: "auto_save", enabled: true }, say("一"), say("二")]),
    ]);
    h.engine.start(); // 「一」上屏 → 写 1
    expect(h.port.writes.length).toBe(1);
    h.engine.advance(); // 「二」上屏 → 写 2
    expect(h.port.writes.length).toBe(2);
    h.engine.back(); // 离开画面补交（flush）与重放都不触发 → 仍 2
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    expect(h.port.writes.length).toBe(2);
    h.dispose();
  });

  it("enabled 非布尔 fail-closed（绕过解析层直接构造）", () => {
    const engine = new StoryEngine({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "auto_save", enabled: 1 }] },
      ],
    });
    const errors: string[] = [];
    const off = engine.onEvent((e) => {
      if (e.payload.kind === "engine.error") errors.push(e.payload.code);
    });
    engine.start();
    expect(errors).toContain("auto_save-invalid");
    off();
    engine.dispose();
  });
});

describe("01 §二.3 load op（锚点: load-op-teleports）", () => {
  it("读档传送回档内等待点（异步 importSave）", async () => {
    const h = makeHarness([
      column("a", [
        say("一"),
        { op: "save", slot: "s1" },
        say("二"),
        { op: "load", slot: "s1" },
        say("不应到达"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance(); // 「二」等待（save 在「一」解除后写入档内画面=「一」解除时 live=「二」显示前？）
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    h.engine.advance(); // load kick（异步）→ importSave 传送回「二」等待
    await vi.waitFor(() =>
      expect(h.engine.get(SYS.currentDialogText)).toBe("二"),
    );
    // 传送后等待画面恢复（重放重建），而非「不应到达」
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("读不存在的槽位：engine.error 可观测、状态原样（fail-closed）", async () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "load", slot: "ghost" }]),
    ]);
    h.engine.start();
    h.engine.advance();
    await vi.waitFor(() => expect(h.errors).toContain("load-failed"));
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    h.dispose();
  });
});

describe("01 §二.3 save_delete op（锚点: save-delete-keeps-high-water）", () => {
  it("异步删除槽位（编排侧验证调用；K4 高水位语义 Rust 侧 delete_save 测试锁定）", async () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "save_delete", slot: "old_slot" }]),
    ]);
    h.engine.start();
    h.engine.advance();
    await vi.waitFor(() => expect(h.port.removes).toEqual(["old_slot"]));
    h.dispose();
  });

  it("无 SavePort fail-closed", () => {
    const h = makeHarness(
      [column("a", [say("一"), { op: "save_delete", slot: "s" }])],
      false,
    );
    h.engine.start();
    h.engine.advance();
    expect(h.errors).toContain("save-unavailable");
    h.dispose();
  });
});

describe("02 §三.2 命令面 save/load 完成信号（锚点: save-load-command-completion）", () => {
  function kindsOf(h: Harness): string[] {
    const kinds: string[] = [];
    h.engine.onEvent((e) => kinds.push(e.payload.kind));
    return kinds;
  }

  it("save(slot,title)：写档成功发 save.done（含槽位）；title/模式与 op 路径同构", async () => {
    const h = makeHarness([column("a", [say("一")])]);
    const kinds = kindsOf(h);
    h.engine.start(); // 「一」等待 = 合法存档坐标
    expect(h.engine.save("slot_1", "手动存")).toBe(true); // kick 立即返回
    await vi.waitFor(() => expect(kinds).toContain("save.done"));
    const w = h.port.writes[0]!;
    expect(w.slot).toBe("slot_1");
    expect(w.data.title).toBe("手动存");
    expect(w.mode).toBe("machine-bound");
    h.dispose();
  });

  it("save 守卫失败不发完成信号：未启动 / 槽名非法 / 无端口（E3 fail-closed）", () => {
    const h = makeHarness([column("a", [say("一")])]);
    const kinds = kindsOf(h);
    expect(h.engine.save("slot_1")).toBe(false); // 未启动
    h.engine.start();
    expect(h.engine.save("../evil")).toBe(false); // 槽名非法
    expect(kinds).not.toContain("save.done");
    expect(h.port.writes.length).toBe(0);
    const h2 = makeHarness([column("a", [say("一")])], false);
    const kinds2 = kindsOf(h2);
    h2.engine.start();
    expect(h2.engine.save("slot_1")).toBe(false); // 无端口
    expect(kinds2).not.toContain("save.done");
    h.dispose();
    h2.dispose();
  });

  it("load(slot)：读档重放完成发 load.done，状态与画面回到存档时刻", async () => {
    const h = makeHarness([
      column("a", [
        { op: "set", key: "n", value: 1 },
        say("一"),
        { op: "set", key: "n", value: 2 },
        say("二"),
      ]),
    ]);
    const kinds = kindsOf(h);
    h.engine.start(); // 「一」等待，n = 1
    expect(h.engine.get("n")).toBe(1);
    expect(h.engine.save("slot_1")).toBe(true);
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    h.engine.advance(); // 「二」等待，n = 2
    expect(h.engine.get("n")).toBe(2);
    expect(h.engine.load("slot_1")).toBe(true);
    await vi.waitFor(() => expect(kinds).toContain("load.done"));
    expect(h.engine.get("n")).toBe(1); // 状态回档
    expect(h.engine.get(SYS.currentDialogText)).toBe("一"); // 画面回档（重放重建）
    h.dispose();
  });

  it("load 失败不发完成信号：坏载荷（版本不符）/ 槽位不存在", async () => {
    const h = makeHarness([column("a", [say("一")])]);
    const kinds = kindsOf(h);
    h.engine.start();
    await h.port.write(
      "bad",
      JSON.stringify({ formatVersion: 99 }),
      "machine-bound",
    );
    expect(h.engine.load("bad")).toBe(true); // kick 接受，失败在异步侧
    await vi.waitFor(() => expect(h.errors).toContain("save-format"));
    expect(h.engine.load("ghost")).toBe(true);
    await vi.waitFor(() => expect(h.errors).toContain("load-failed"));
    expect(kinds).not.toContain("load.done");
    h.dispose();
  });

  it("完成信号只来自命令面：故事 save op（等待点落档）不发 save.done（作用域裁定）", async () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "save", slot: "slot_1" }, say("二")]),
    ]);
    const kinds = kindsOf(h);
    h.engine.start();
    h.engine.advance();
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    expect(kinds).not.toContain("save.done");
    h.dispose();
  });
});
