/**
 * 存档扩展依赖标记 + 存档向后兼容测试。
 *
 * 测试要点：
 * - **标记粒度 = 本档实际执行过的扩展**（op 执行时登记）——未用到 = 字段缺席，
 *   缺扩展也能读（防假阳性）；读档后标记随档继承（再存档不丢依赖）
 * - **读档 fail-closed 整档预校验**：缺扩展（extension-missing）/ 版本不可达（extension-version）/
 *   restore 失败（extension-restore）/ 坏标记载荷（save-format）→ 整档拒绝 + 状态原样
 * - **版本迁移**：档旧 → 扩展 migrate（state 不含 ext.<id>. 前缀，与门卫视角一致）放行 +
 *   load.notice；档新于扩展 → 拒绝
 * - **向后兼容（用户定调引擎职责）**：cursor 缺失回默认（最近检查点，空历史落 -1）、
 *   类型错 fail-closed；history 深层字段缺失 fail-closed（杜绝 NaN/TypeError 进恢复流程）；
 *   可选字段缺席 + 未知额外字段双向兼容；formatVersion≠1 → migrateSave 钩子迁移或可操作拒绝
 */
import { describe, expect, it } from "vitest";
import type { OpExtension, SaveDataV1 } from "@lingfan/engine";
import { StoryEngine } from "@lingfan/engine";

function demoExtension(
  overrides: Partial<OpExtension> = {},
  stateVersion = 1,
): OpExtension {
  return {
    id: "demo",
    stateVersion,
    ops: [
      {
        op: "demo_counter",
        exec: (cmd, ctx) => {
          const key = typeof cmd.key === "string" ? cmd.key : "default";
          const current =
            typeof ctx.get(key) === "number" ? (ctx.get(key) as number) : 0;
          ctx.set(key, current + 1);
          return { ok: true };
        },
      },
    ],
    ...overrides,
  };
}

/** 三句旅程：advance 一次后 runs = 1、历史 1 个检查点、停在「二」 */
const JOURNEY = [
  {
    id: "a",
    kind: "flow",
    commands: [
      { op: "say", text: "一" },
      { op: "demo_counter", key: "runs" },
      { op: "say", text: "二" },
    ],
  },
];

/** 无扩展 op 的普通旅程：advance 一次后 gold = 10、历史 1 个检查点、停在「二」 */
const PLAIN_JOURNEY = [
  {
    id: "a",
    kind: "flow",
    commands: [
      { op: "say", text: "一" },
      { op: "set", key: "gold", value: 10 },
      { op: "say", text: "二" },
    ],
  },
];

function makeEngine(
  extensions: readonly OpExtension[] = [],
  options: Record<string, unknown> = {},
  columns: object[] = JOURNEY,
) {
  const errors: { code: string; message: string }[] = [];
  const notices: string[] = [];
  const engine = new StoryEngine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { formatVersion: 1, id: "t", entry: "a", columns } as any,
    { extensions, ...options },
  );
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") {
      errors.push({ code: e.payload.code, message: e.payload.message });
    }
    if (e.payload.kind === "load.notice") notices.push(e.payload.text);
  });
  return { engine, errors, notices, off };
}

/** 旅程存档：执行 demo_counter 一次 → 停在「二」（带扩展依赖标记） */
function makeMarkedSave(stateVersion = 1): {
  data: SaveDataV1;
  raw: Record<string, unknown>;
} {
  const { engine, off } = makeEngine([demoExtension({}, stateVersion)]);
  engine.start();
  engine.advance();
  const data = engine.exportSave();
  expect(data).not.toBeNull();
  off();
  engine.dispose();
  return { data: data as SaveDataV1, raw: structuredClone(data) as unknown as Record<string, unknown> };
}

/** 普通旅程存档（无扩展依赖标记）：gold = 10、历史 1 项、停在「二」 */
function makePlainSave(): { data: SaveDataV1; raw: Record<string, unknown> } {
  const { engine, off } = makeEngine([], {}, PLAIN_JOURNEY);
  engine.start();
  engine.advance();
  const data = engine.exportSave();
  expect(data).not.toBeNull();
  off();
  engine.dispose();
  return { data: data as SaveDataV1, raw: structuredClone(data) as unknown as Record<string, unknown> };
}

describe("存档扩展依赖标记", () => {
  it("执行过扩展的存档带依赖标记；同扩展引擎读档成功", () => {
    const { data } = makeMarkedSave();
    expect(data.extensions).toEqual([{ id: "demo", stateVersion: 1 }]);
    const revived = makeEngine([demoExtension()]);
    expect(
      revived.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    expect(revived.engine.get("ext.demo.runs")).toBe(1);
    revived.off();
    revived.engine.dispose();
  });

  it("未用到扩展的存档不带标记；缺扩展也能读（防假阳性）", () => {
    const { engine, off } = makeEngine([demoExtension()]); // 注册但未执行
    engine.start(); // 停在「一」：demo_counter 未执行
    const data = engine.exportSave();
    expect(data?.extensions).toBeUndefined();
    off();
    engine.dispose();
    const revived = makeEngine([]); // 未注册该扩展
    expect(
      revived.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    revived.off();
    revived.engine.dispose();
  });

  it("缺扩展 → extension-missing 整档拒绝 + 状态原样（可继续游玩）", () => {
    const { data } = makeMarkedSave();
    const revived = makeEngine([]); // 未注册 demo
    revived.engine.start(); // 先进等待点：验证拒绝后状态原样
    const historyBefore = revived.engine.historyView().length;
    expect(
      revived.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(false);
    expect(revived.errors.some((e) => e.code === "extension-missing")).toBe(true);
    expect(revived.engine.get("ext.demo.runs")).toBeUndefined(); // 状态原样
    expect(revived.engine.historyView().length).toBe(historyBefore);
    expect(revived.engine.get("__current_dialog_text")).toBe("一"); // 等待点原样：拒绝不损伤会话
    revived.off();
    revived.engine.dispose();
  });

  it("版本不可达（档新于扩展 / 无 migrate）→ extension-version 整档拒绝", () => {
    const { raw } = makeMarkedSave();
    raw.extensions = [{ id: "demo", stateVersion: 2 }]; // 档 v2 vs 引擎 v1（无迁移路径）
    const revived = makeEngine([demoExtension()]);
    expect(revived.engine.importSave(raw as unknown as SaveDataV1)).toBe(false);
    expect(revived.errors.some((e) => e.code === "extension-version")).toBe(true);
    revived.off();
    revived.engine.dispose();
  });

  it("档旧 → migrate 迁移放行 + load.notice + 状态按迁移结果恢复（键不含前缀）", () => {
    const { data } = makeMarkedSave(1); // 档标记 v1
    const upgraded = makeEngine(
      [
        demoExtension(
          {
            migrate: (from, state) => {
              expect(from).toBe(1);
              expect(state).toEqual({ runs: 1 }); // 命名空间内键值（无 ext.demo. 前缀）
              return { runs: (state.runs as number) * 10 };
            },
          },
          2,
        ),
      ],
      {},
    );
    expect(
      upgraded.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    expect(upgraded.engine.get("ext.demo.runs")).toBe(10); // 迁移后的值落回前缀命名空间
    expect(upgraded.notices.some((t) => t.includes("demo") && t.includes("v2"))).toBe(
      true,
    );
    upgraded.off();
    upgraded.engine.dispose();
  });

  it("migrate 返回 null / 抛出 → extension-version 整档拒绝（状态原样）", () => {
    const { raw } = makeMarkedSave(1);
    raw.extensions = [{ id: "demo", stateVersion: 1 }];
    const nullMigrate = makeEngine([
      demoExtension({ migrate: () => null }, 2),
    ]);
    expect(nullMigrate.engine.importSave(structuredClone(raw) as unknown as SaveDataV1)).toBe(false);
    expect(nullMigrate.errors.some((e) => e.code === "extension-version")).toBe(true);
    nullMigrate.off();
    nullMigrate.engine.dispose();
    const throwMigrate = makeEngine([
      demoExtension(
        {
           
          migrate: () => {
            throw new Error("扩展迁移炸了");
          },
        },
        2,
      ),
    ]);
    expect(throwMigrate.engine.importSave(structuredClone(raw) as unknown as SaveDataV1)).toBe(false);
    expect(throwMigrate.errors.some((e) => e.code === "extension-version")).toBe(true);
    throwMigrate.off();
    throwMigrate.engine.dispose();
  });

  it("坏 extensions 载荷 fail-closed（非数组 / 缺字段 / 畸形 → save-format）", () => {
    const { raw } = makeMarkedSave();
    const bads: unknown[] = [
      "not-an-array",
      [{ id: 1, stateVersion: 1 }],
      [{ id: "demo" }],
      [{ id: "demo", stateVersion: 0 }],
      [null],
    ];
    for (const [i, bad] of bads.entries()) {
      const revived = makeEngine([demoExtension()]);
      const payload = { ...structuredClone(raw), extensions: bad };
      expect(
        revived.engine.importSave(payload as unknown as SaveDataV1),
        `坏载荷 #${String(i)}`,
      ).toBe(false);
      expect(revived.errors.at(-1)?.code, `坏载荷 #${String(i)}`).toBe("save-format");
      revived.off();
      revived.engine.dispose();
    }
  });

  it("restore 返回 false / 抛出 → extension-restore 整档拒绝 + 状态原样", () => {
    const { raw } = makeMarkedSave(1);
    raw.extensions = [{ id: "demo", stateVersion: 1 }];
    const refused = makeEngine([demoExtension({ restore: () => false })]);
    refused.engine.start();
    const historyBefore = refused.engine.historyView().length;
    expect(refused.engine.importSave(structuredClone(raw) as unknown as SaveDataV1)).toBe(false);
    expect(refused.errors.some((e) => e.code === "extension-restore")).toBe(true);
    expect(refused.engine.historyView().length).toBe(historyBefore); // 状态原样
    refused.off();
    refused.engine.dispose();
    const thrown = makeEngine([
      demoExtension({
         
        restore: () => {
          throw new Error("restore 炸了");
        },
      }),
    ]);
    expect(thrown.engine.importSave(structuredClone(raw) as unknown as SaveDataV1)).toBe(false);
    expect(thrown.errors.some((e) => e.code === "extension-restore")).toBe(true);
    thrown.off();
    thrown.engine.dispose();
  });

  it("读档后依赖标记随档继承（再存档不丢依赖）", () => {
    const { data } = makeMarkedSave();
    const revived = makeEngine([demoExtension()]);
    expect(revived.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1)).toBe(true);
    const resaved = revived.engine.exportSave();
    expect(resaved?.extensions).toEqual([{ id: "demo", stateVersion: 1 }]);
    revived.off();
    revived.engine.dispose();
  });
});

describe("存档向后兼容", () => {
  it("a) 缺 cursor 的旧档 → 回默认最近检查点且回溯可用，不得 NaN；空历史落 -1（无检查点语义）", () => {
    const { data } = makePlainSave(); // history 1 项、cursor 0
    const noCursor = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    delete noCursor.cursor;
    const revived = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived.engine.importSave(noCursor as unknown as SaveDataV1)).toBe(true);
    revived.engine.rollbackTo(0); // 回溯可用（cursor 回默认最近检查点，非 NaN）
    expect(revived.engine.get("gold")).toBeUndefined(); // 回到检查点 0（set 之前）
    revived.off();
    revived.engine.dispose();

    const { engine: fresh, off: freshOff } = makeEngine([], {}, PLAIN_JOURNEY);
    fresh.start(); // 首个 say 等待点：历史为空、cursor = -1
    const empty = fresh.exportSave();
    expect(empty?.history).toHaveLength(0);
    freshOff();
    fresh.dispose();
    const emptyNoCursor = JSON.parse(JSON.stringify(empty)) as Record<string, unknown>;
    delete emptyNoCursor.cursor;
    const revivedEmpty = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revivedEmpty.engine.importSave(emptyNoCursor as unknown as SaveDataV1)).toBe(true);
    revivedEmpty.off();
    revivedEmpty.engine.dispose();
  });

  it("a') cursor 类型错 → fail-closed（缺 → 默认，类型错 → 拒）", () => {
    const { raw } = makePlainSave();
    raw.cursor = "0";
    const revived = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived.engine.importSave(raw as unknown as SaveDataV1)).toBe(false);
    expect(revived.errors.at(-1)?.code).toBe("save-format");
    revived.off();
    revived.engine.dispose();
  });

  it("b) 缺 history[].state / rngState → save-format（而非恢复期 TypeError）", () => {
    const { raw } = makePlainSave();
    const history = structuredClone(raw.history) as Array<Record<string, unknown>>;
    delete (history[0] as Record<string, unknown>).state;
    const noState = { ...structuredClone(raw), history };
    const revived = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived.engine.importSave(noState as unknown as SaveDataV1)).toBe(false);
    expect(revived.errors.at(-1)?.code).toBe("save-format");
    revived.off();
    revived.engine.dispose();

    const badRng = {
      ...structuredClone(raw),
      history: [{ ...history[0], state: [], rngState: "x" }],
    };
    const revived2 = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived2.engine.importSave(badRng as unknown as SaveDataV1)).toBe(false);
    expect(revived2.errors.at(-1)?.code).toBe("save-format");
    revived2.off();
    revived2.engine.dispose();
  });

  it("b') rngState / coord.index 为 NaN → fail-closed（NaN 不深入恢复流程）", () => {
    const { raw } = makePlainSave();
    const nanRng = { ...structuredClone(raw), rngState: Number.NaN };
    const revived = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived.engine.importSave(nanRng as unknown as SaveDataV1)).toBe(false);
    expect(revived.errors.at(-1)?.code).toBe("save-format");
    revived.off();
    revived.engine.dispose();
    const nanIndex = structuredClone(raw) as Record<string, unknown>;
    (nanIndex.coord as Record<string, unknown>).index = Number.NaN;
    const revived2 = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived2.engine.importSave(nanIndex as unknown as SaveDataV1)).toBe(false);
    expect(revived2.errors.at(-1)?.code).toBe("save-format");
    revived2.off();
    revived2.engine.dispose();
  });

  it("c) 可选字段缺席 + 未知额外字段 → 双向兼容（旧档可读 / 新档旧引擎可读）", () => {
    const { data } = makePlainSave();
    const minimal = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    delete minimal.title; // 可选字段缺席（旧档形态）
    delete minimal.screenshot;
    const revived = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived.engine.importSave(minimal as unknown as SaveDataV1)).toBe(true);
    revived.off();
    revived.engine.dispose();
    const futuristic = {
      ...structuredClone(data),
      futureField: { whatever: true }, // 未来版本新增字段：旧引擎忽略不拒
    };
    const revived2 = makeEngine([], {}, PLAIN_JOURNEY);
    expect(revived2.engine.importSave(futuristic as unknown as SaveDataV1)).toBe(true);
    revived2.off();
    revived2.engine.dispose();
  });

  it("d) formatVersion 2：无钩子 → 可操作拒绝；有钩子 → 迁移放行 + load.notice；钩子抛出 → 不炸穿", () => {
    const { raw } = makePlainSave();
    const v2 = { ...structuredClone(raw), formatVersion: 2 };
    const strict = makeEngine([], {}, PLAIN_JOURNEY);
    expect(strict.engine.importSave(structuredClone(v2) as unknown as SaveDataV1)).toBe(false);
    const strictMsg = strict.errors.at(-1)?.message ?? "";
    expect(strictMsg).toContain("v2");
    expect(strictMsg).toContain("migrateSave"); // 文案可操作：给出迁移路径
    strict.off();
    strict.engine.dispose();

    const migrating = makeEngine(
      [],
      {
        migrateSave: (d: unknown) => {
          expect(d).toEqual(v2);
          return { ...(d as SaveDataV1), formatVersion: 1 };
        },
      },
      PLAIN_JOURNEY,
    );
    expect(migrating.engine.importSave(structuredClone(v2) as unknown as SaveDataV1)).toBe(true);
    expect(migrating.notices.some((t) => t.includes("v2") && t.includes("v1"))).toBe(true);
    migrating.off();
    migrating.engine.dispose();

    const throwing = makeEngine(
      [],
      {
         
        migrateSave: () => {
          throw new Error("钩子炸了");
        },
      },
      PLAIN_JOURNEY,
    );
    expect(throwing.engine.importSave(structuredClone(v2) as unknown as SaveDataV1)).toBe(false);
    expect(throwing.errors.at(-1)?.code).toBe("save-format"); // 可操作拒绝而非异常炸穿
    throwing.off();
    throwing.engine.dispose();
  });
});
