/**
 * 存档兼容与迁移测试：墓碑垫底 / migrateState / storyVersion / 玩法系统版本化。
 * - undef 全局键记墓碑进档；帧层（let/local）undef 不记
 * - 读档垫底：story.defines 默认值补齐当前态与每个历史检查点（墓碑挡板防复活）
 * - storyVersion 对账只在当前故事声明 version 时激活；旧档（无字段）按 0
 * - 玩法系统依赖标记与扩展同构：missing / version / migrate 三态
 * SavePort 为契约替身（内存实现）；Rust 侧安全校验在 cargo 侧测。
 */
import { describe, expect, it, vi } from "vitest";
import type { SaveDataV1, SaveMode, SlotSummary } from "@lingfan-engine/core";
import { StoryEngine, parseStory } from "@lingfan-engine/core";

interface WriteCall {
  slot: string;
  data: SaveDataV1;
  mode: SaveMode;
}

class MemorySavePort {
  readonly writes: WriteCall[] = [];
  private readonly slots = new Map<string, string>();

  seed(slot: string, payload: string): void {
    this.slots.set(slot, payload);
  }

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
}

interface HarnessOptions {
  defines?: Record<string, unknown>;
  version?: number;
  migrateState?: (
    state: Record<string, unknown>,
    from: { storyVersion: number },
  ) => Record<string, unknown> | null;
  minigames?: readonly {
    gameId: string;
    stateVersion: number;
    migrate?: (
      fromStateVersion: number,
      state: Readonly<Record<string, unknown>>,
    ) => Record<string, unknown> | null;
  }[];
}

interface Harness {
  engine: StoryEngine;
  port: MemorySavePort;
  errors: string[];
  kinds: string[];
  notices: string[];
  dispose: () => void;
}

function makeHarness(columns: object[], opts: HarnessOptions = {}): Harness {
  const port = new MemorySavePort();
  const base = parseStory({
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns,
    ...(opts.defines !== undefined ? { defines: opts.defines } : {}),
  });
  const engine = new StoryEngine(
    opts.version !== undefined ? { ...base, version: opts.version } : base,
    {
      savePort: port,
      ...(opts.migrateState !== undefined
        ? { migrateState: opts.migrateState }
        : {}),
      ...(opts.minigames !== undefined ? { minigames: opts.minigames } : {}),
    },
  );
  const errors: string[] = [];
  const kinds: string[] = [];
  const notices: string[] = [];
  const off = engine.onEvent((e) => {
    kinds.push(e.payload.kind);
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
    if (e.payload.kind === "load.notice") notices.push(e.payload.text);
  });
  return {
    engine,
    port,
    errors,
    kinds,
    notices,
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

/** 读档前置：load 仅在启动后可用（load-invalid）——新引擎先 start 再 load */
function loadSlot(h: Harness, slot: string): boolean {
  h.engine.start();
  return h.engine.load(slot);
}

/** 版本特性落地前的存量档形态（无 storyVersion/deleted/minigames 字段） */
function legacySave(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    formatVersion: 1,
    storyId: "t",
    coord: { columnId: "a", index: 0 },
    state: [] as [string, unknown][],
    rngState: 1,
    functions: [],
    history: [],
    ...overrides,
  });
}

describe("墓碑与垫底", () => {
  it("undef 全局键：墓碑进档，读档垫底被挡（默认值不复活）", async () => {
    const h = makeHarness(
      [
        column("a", [
          { op: "undef", key: "hp" },
          { op: "save", slot: "s1" },
          say("x"),
        ]),
      ],
      { defines: { gold: 10, hp: 1 } },
    );
    h.engine.start();
    h.engine.advance();
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    expect(h.port.writes[0]!.data.deleted).toEqual(["hp"]);
    const h2 = makeHarness([column("a", [say("x")])], {
      defines: { gold: 10, hp: 1 },
    });
    h2.port.seed("s1", JSON.stringify(h.port.writes[0]!.data));
    expect(loadSlot(h2, "s1")).toBe(true);
    return vi
      .waitFor(() => expect(h2.kinds).toContain("load.done"))
      .then(() => {
        expect(h2.engine.get("gold")).toBe(10); // 垫底已跑（档内已有键不覆盖）
        expect(h2.engine.get("hp")).toBeUndefined(); // 墓碑挡板：默认值不复活
      })
      .finally(() => {
        h.dispose();
        h2.dispose();
      });
  });

  it("undef 仅 let/local（帧层）：不记墓碑", async () => {
    const h = makeHarness([
      column("a", [
        { op: "let", key: "hp", value: 5 },
        { op: "undef", key: "hp" },
        { op: "save", slot: "s1" },
        say("x"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance();
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    expect(h.port.writes[0]!.data.deleted).toBeUndefined();
    h.dispose();
  });

  it("垫底：升级新增 define 默认值，旧档当前态与历史回溯都补齐", async () => {
    const h = makeHarness(
      [
        column("a", [
          { op: "set", key: "gold", value: 99 },
          say("A"),
          { op: "save", slot: "s1" },
          say("B"),
        ]),
      ],
      { defines: { gold: 10 } },
    );
    h.engine.start();
    h.engine.advance(); // say A 等待（检查点 0）
    h.engine.advance(); // save + say B 等待
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    const saved = h.port.writes[0]!.data;
    h.dispose();
    // 「升级」：同一故事新增 mana define
    const h2 = makeHarness(
      [column("a", [say("A"), { op: "save", slot: "s1" }, say("B")])],
      { defines: { gold: 10, mana: 9 } },
    );
    h2.port.seed("s1", JSON.stringify(saved));
    expect(loadSlot(h2, "s1")).toBe(true);
    return vi
      .waitFor(() => expect(h2.kinds).toContain("load.done"))
      .then(() => {
        expect(h2.engine.get("gold")).toBe(99); // 档内已有键不覆盖（mana===9 来自 defines 无判别力）
        h2.engine.rollbackTo(0); // 历史检查点同样垫过
        expect(h2.engine.get("mana")).toBe(9);
        expect(h2.engine.get("gold")).toBe(99);
      })
      .finally(() => h2.dispose());
  });

  it("墓碑随快照回溯：回滚到 undef 前检查点，删除记录同步回退", async () => {
    const h = makeHarness(
      [
        column("a", [
          say("A"),
          { op: "undef", key: "hp" },
          say("B"),
          { op: "save", slot: "s1" },
          say("C"),
        ]),
      ],
      { defines: { hp: 1 } },
    );
    h.engine.start();
    h.engine.advance(); // say A（检查点 0）
    h.engine.advance(); // undef + say B
    expect(h.engine.get("hp")).toBeUndefined();
    h.engine.rollbackTo(0);
    expect(h.engine.get("hp")).toBe(1); // 状态回滚
    h.engine.advance(); // 重放 undef + say B
    expect(h.engine.get("hp")).toBeUndefined(); // 墓碑重新记账
    h.engine.advance(); // save + say C
    // 回滚重放会再次经过 save 命令（存两档）：第二档才是重放后的墓碑记账
    return vi
      .waitFor(() => expect(h.port.writes.length).toBe(2))
      .then(() => {
        expect(h.port.writes[0]!.data.deleted).toEqual(["hp"]);
        expect(h.port.writes[1]!.data.deleted).toEqual(["hp"]); // 重放后重新记账
      })
      .finally(() => h.dispose());
  });
});

describe("storyVersion 与 migrateState", () => {
  it("旧档（无版本字段）对未声明 version 的故事全链直读", () => {
    const h = makeHarness([column("a", [say("x")])], { defines: { gold: 10 } });
    h.port.seed("s1", legacySave({ state: [["gold", 5]] }));
    expect(loadSlot(h, "s1")).toBe(true);
    return vi
      .waitFor(() => {
        expect(h.engine.get("gold")).toBe(5);
        expect(h.kinds).toContain("load.done");
      })
      .finally(() => h.dispose());
  });

  it("声明 version 的故事：同版本档直读，storyVersion 随档恒写", async () => {
    const h = makeHarness(
      [column("a", [say("x"), { op: "save", slot: "s1" }, say("y")])],
      { version: 2 },
    );
    h.engine.start();
    h.engine.advance(); // say x
    h.engine.advance(); // save + say y
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    expect(h.port.writes[0]!.data.storyVersion).toBe(2);
    expect(h.engine.load("s1")).toBe(true); // 已启动会话，直接读档（同版本直读）
    await vi.waitFor(() => expect(h.kinds).toContain("load.done"));
    h.dispose();
  });

  it("旧档 + 声明 version + 无钩子 → save-story-version 拒绝", () => {
    const h = makeHarness([column("a", [say("x")])], { version: 2 });
    h.port.seed("s1", legacySave());
    expect(loadSlot(h, "s1")).toBe(true); // kick 接受，拒绝在异步侧
    return vi
      .waitFor(() => {
        expect(h.errors).toContain("save-story-version");
        expect(h.kinds).not.toContain("load.done");
      })
      .finally(() => h.dispose());
  });

  it("旧档 + 声明 version + 钩子 → 迁移后读入（含垫底与 notice）", () => {
    const h = makeHarness([column("a", [say("x")])], {
      version: 2,
      defines: { hp: 1, luck: 2 },
      migrateState: (state, from) =>
        from.storyVersion === 0 ? { hp: state.mp } : null,
    });
    h.port.seed("s1", legacySave({ state: [["mp", 7]] }));
    expect(loadSlot(h, "s1")).toBe(true);
    return vi
      .waitFor(() => {
        expect(h.engine.get("hp")).toBe(7); // 钩子改名
        expect(h.engine.get("luck")).toBe(2); // 垫底
        expect(
          h.notices.some((t) => t.includes("v0") && t.includes("v2")),
        ).toBe(true);
      })
      .finally(() => h.dispose());
  });

  it("钩子抛错或返回 null → save-migrate-failed；畸形 storyVersion → save-format", () => {
    const boom = makeHarness([column("a", [say("x")])], {
      version: 2,
      migrateState: () => {
        throw new Error("boom");
      },
    });
    boom.port.seed("s1", legacySave());
    expect(loadSlot(boom, "s1")).toBe(true);
    const nulled = makeHarness([column("a", [say("x")])], {
      version: 2,
      migrateState: () => null,
    });
    nulled.port.seed("s1", legacySave());
    expect(loadSlot(nulled, "s1")).toBe(true);
    const malformed = makeHarness([column("a", [say("x")])], { version: 2 });
    malformed.port.seed("s1", legacySave({ storyVersion: 0 }));
    expect(loadSlot(malformed, "s1")).toBe(true);
    return vi
      .waitFor(() => {
        expect(boom.errors).toContain("save-migrate-failed");
        expect(nulled.errors).toContain("save-migrate-failed");
        expect(malformed.errors).toContain("save-format");
      })
      .finally(() => {
        boom.dispose();
        nulled.dispose();
        malformed.dispose();
      });
  });
});

describe("玩法系统版本化", () => {
  it("resolveMinigame 回填状态 → minigames 依赖标记随档落盘", async () => {
    const h = makeHarness(
      [column("a", [{ op: "minigame", game: "puzzle" }, say("x")])],
      { minigames: [{ gameId: "puzzle", stateVersion: 2 }] },
    );
    h.engine.start();
    expect(
      h.engine.resolveMinigame({ outcome: "success", state: { score: 5 } }),
    ).toBe(true);
    h.engine.save("s1");
    await vi.waitFor(() => expect(h.port.writes.length).toBe(1));
    expect(h.engine.get("game.puzzle.score")).toBe(5);
    expect(h.port.writes[0]!.data.minigames).toEqual([
      { id: "puzzle", stateVersion: 2 },
    ]);
    h.dispose();
  });

  it("读档四态：缺注册拒 / 旧版迁移 / 版本超前拒 / 未用到不带标记直读", () => {
    const payloadWith = (stateVersion: number): string =>
      legacySave({
        state: [["game.puzzle.score", 5]],
        minigames: [{ id: "puzzle", stateVersion }],
      });
    const missing = makeHarness([column("a", [say("x")])]);
    missing.port.seed("s1", payloadWith(2));
    expect(loadSlot(missing, "s1")).toBe(true);
    const migrated = makeHarness([column("a", [say("x")])], {
      minigames: [
        {
          gameId: "puzzle",
          stateVersion: 2,
          migrate: (_from, state) => ({ score: (state.score as number) + 1 }),
        },
      ],
    });
    migrated.port.seed("s1", payloadWith(1));
    expect(loadSlot(migrated, "s1")).toBe(true);
    const ahead = makeHarness([column("a", [say("x")])], {
      minigames: [{ gameId: "puzzle", stateVersion: 2 }],
    });
    ahead.port.seed("s1", payloadWith(3));
    expect(loadSlot(ahead, "s1")).toBe(true);
    const unused = makeHarness([column("a", [say("x")])]);
    unused.port.seed("s1", legacySave({ state: [["gold", 1]] }));
    expect(loadSlot(unused, "s1")).toBe(true);
    return vi
      .waitFor(() => {
        expect(missing.errors).toContain("minigame-missing");
        expect(ahead.errors).toContain("minigame-version");
        expect(migrated.notices.some((t) => t.includes("puzzle"))).toBe(true);
        expect(unused.kinds).toContain("load.done");
      })
      .finally(() => {
        missing.dispose();
        migrated.dispose();
        ahead.dispose();
        unused.dispose();
      });
  });

  it("迁移后的玩法系统状态落命名空间；game.* 键不从 defines 垫底", () => {
    const h = makeHarness([column("a", [say("x")])], {
      defines: { "game.x": 1, gold: 5 },
      minigames: [
        {
          gameId: "puzzle",
          stateVersion: 2,
          migrate: () => ({ score: 99 }),
        },
      ],
    });
    h.port.seed(
      "s1",
      legacySave({
        state: [["game.puzzle.old", 1]],
        minigames: [{ id: "puzzle", stateVersion: 1 }],
      }),
    );
    expect(loadSlot(h, "s1")).toBe(true);
    return vi
      .waitFor(() => {
        expect(h.engine.get("game.puzzle.score")).toBe(99); // 迁移重落前缀
        expect(h.engine.get("game.puzzle.old")).toBeUndefined(); // 旧键随迁移清出
        expect(h.engine.get("gold")).toBe(5); // defines 垫底
        expect(h.engine.get("game.x")).toBeUndefined(); // game.* 不垫底
      })
      .finally(() => h.dispose());
  });
});
