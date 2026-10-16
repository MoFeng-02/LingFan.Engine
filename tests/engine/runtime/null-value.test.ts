/**
 * 状态值域 null 契约：null 是状态槽的合法「空值」（undef 才是销毁）。
 * - set/define（含 defines 初始化）落 null；ValueChanged 保留 null 负载
 * - {null} 表达式字面量与 nullish 运算符（null 键名已知 → ?? 兜底生效；
 *   undef 键名不存在 → unknown-variable，?? 不救未知名）
 * - 复合赋值遇 null 仍 type-error（number 检查不因 null 放宽）
 * - 未兜底插值保留原文 + type-error；存档快照 round-trip 保留 null
 */
import { describe, expect, it, vi } from "vitest";
import type {
  OutboundEvent,
  SaveDataV1,
  SaveMode,
  ValueChanged,
} from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

interface WriteCall {
  slot: string;
  data: SaveDataV1;
  mode: SaveMode;
}

class MemorySavePort {
  readonly writes: WriteCall[] = [];
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

  async list(): Promise<
    { slot: string; saveCount: number; timestamp: number; mode: SaveMode }[]
  > {
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
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function makeHarness(
  commands: object[],
  defines?: Record<string, unknown>,
): Harness {
  const port = new MemorySavePort();
  const json: unknown = {
    formatVersion: 1,
    id: "null-value",
    ...(defines === undefined ? {} : { defines }),
    columns: [{ id: "start", kind: "flow", commands }],
  };
  const engine = new StoryEngine(parseStory(json), { savePort: port });
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    port,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
      engine.dispose();
    },
  };
}

function errorPayload(event: OutboundEvent | undefined): {
  code: string;
  message: string;
} {
  if (event === undefined || event.payload.kind !== "engine.error") {
    throw new Error(
      `期望 engine.error，实际：${JSON.stringify(event?.payload)}`,
    );
  }
  return { code: event.payload.code, message: event.payload.message };
}

function hasError(errors: OutboundEvent[], code: string): boolean {
  return errors.some(
    (e) => e.payload.kind === "engine.error" && e.payload.code === code,
  );
}

describe("null 作为状态值", () => {
  it("set null 落状态：get 为 null，ValueChanged 负载保留 null", () => {
    const { engine, changes, dispose } = makeHarness([
      { op: "set", key: "hp", value: null },
      { op: "say", text: "ok" },
    ]);
    engine.start();
    expect(engine.get("hp")).toBeNull();
    expect(changes.find((c) => c.key === "hp")).toMatchObject({
      value: null,
      scope: "global",
    });
    dispose();
  });

  it("define null 与 defines 初始化通道 null 初值；null 不是销毁（键仍存在）", () => {
    const { engine, dispose } = makeHarness(
      [
        { op: "define", key: "mp", value: null },
        { op: "say", text: "ok" },
      ],
      { hp: null },
    );
    engine.start();
    expect(engine.get("hp")).toBeNull();
    expect(engine.get("mp")).toBeNull();
    dispose();
  });

  it("{null} 表达式字面量等价字面 null", () => {
    const { engine, dispose } = makeHarness([
      { op: "set", key: "hp", value: "{null}" },
      { op: "say", text: "ok" },
    ]);
    engine.start();
    expect(engine.get("hp")).toBeNull();
    dispose();
  });

  it("null 键名已知 → ?? 兜底生效；undef 键名不存在 → unknown-variable（?? 不救未知名）", () => {
    const h1 = makeHarness([
      { op: "set", key: "hp", value: null },
      { op: "say", text: '{hp ?? "缺省"}' },
    ]);
    h1.engine.start();
    expect(h1.engine.get(SYS.currentDialogText)).toBe("缺省");
    // null 是已知键上的合法值：写回后 ?? 不再兜底
    h1.dispose();

    const h2 = makeHarness([
      { op: "define", key: "hp", value: 5 },
      { op: "undef", key: "hp" },
      { op: "say", text: '{hp ?? "缺省"}' },
    ]);
    h2.engine.start();
    expect(h2.engine.get("hp")).toBeUndefined();
    expect(hasError(h2.errors, "unknown-variable")).toBe(true);
    expect(h2.engine.get(SYS.currentDialogText)).toBe('{hp ?? "缺省"}');
    h2.dispose();
  });

  it("未兜底插值保留原文并收集 type-error（null 负载）", () => {
    const { engine, errors, dispose } = makeHarness([
      { op: "set", key: "hp", value: null },
      { op: "say", text: "{hp}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("{hp}");
    const err = errors.find((e) => e.payload.kind === "engine.error");
    expect(errorPayload(err).code).toBe("type-error");
    expect(errorPayload(err).message).toContain("可用 ?? 提供默认值");
    dispose();
  });

  it("复合赋值遇 null 仍 type-error（number 检查不因 null 放宽）", () => {
    const { engine, errors, dispose } = makeHarness([
      { op: "set", key: "gold", value: 10 },
      { op: "set", key: "gold", value: null },
      { op: "set", key: "gold", value: "+= {1}" },
      { op: "say", text: "ok" },
    ]);
    engine.start();
    expect(hasError(errors, "type-error")).toBe(true);
    expect(engine.get("gold")).toBeNull();
    dispose();
  });

  it("undef 销毁不受 null 干扰：null 值键照常沿链销毁", () => {
    const { engine, errors, dispose } = makeHarness([
      { op: "define", key: "g", value: null },
      { op: "undef", key: "g" },
      { op: "say", text: "{g}" },
    ]);
    engine.start();
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("存档快照 round-trip 保留 null", async () => {
    const { engine, port, dispose } = makeHarness([
      { op: "set", key: "hp", value: null },
      { op: "say", text: "一" },
      { op: "save", slot: "s1", title: "null" },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.advance(); // 解除「一」→ save 在等待点上 → 「二」等待
    await vi.waitFor(() => expect(port.writes.length).toBe(1));
    const snapshot = port.writes[0]!.data;
    expect(snapshot.state).toContainEqual(["hp", null]);

    engine.load("s1");
    engine.advance(); // load kick（异步）→ 传送回 save 等待点
    await vi.waitFor(() => expect(engine.get("hp")).toBeNull());
    dispose();
  });
});
