/**
 * 自定义 op 注册表测试。
 *
 * 测试要点：
 * - **注册期 fail-fast**：id/op 名形态、内建冲突、跨扩展重复 → 构造抛错带定位
 * - **内建逐字节等价**：扩展查找前置但 switch 一行未动 ⇒ 全量既有测试（949 例）即回归；
 *   本文件另做互锁（BUILTIN_OP_NAMES ↔ dispatch.ts 分发 case 集合精确相等，防漏搬/漂移）
 * - **前缀门卫**：ctx.set/get 物理强制 `ext.<id>.`——扩展物理写不出前缀外的键
 * - **状态进 SSOT**：ctx.set 写入随 ValueChanged/存档/回溯随行（"能进存档"的 SSOT 充分条件）
 * - **fail-closed**：exec 失败/抛出 → engine.error + 停在当前命令；未注册 op 仍 unknown-op
 */
import { describe, expect, it } from "vitest";
import type { OpExtension, SaveDataV1 } from "@lingfan/engine";
import { BUILTIN_OP_NAMES, StoryEngine, SYS } from "@lingfan/engine";
import dispatchSource from "../../../packages/engine/src/runtime/dispatch.ts?raw";

function extension(overrides: Partial<OpExtension> = {}): OpExtension {
  return {
    id: "demo",
    stateVersion: 1,
    ops: [
      {
        op: "demo_counter",
        exec: (cmd, ctx) => {
          const key = typeof cmd.key === "string" ? cmd.key : "default";
          const current = typeof ctx.get(key) === "number" ? (ctx.get(key) as number) : 0;
          ctx.set(key, current + 1);
          return { ok: true };
        },
      },
    ],
    ...overrides,
  };
}

function makeEngine(extensions: readonly OpExtension[], columns: object[]) {
  const errors: { code: string; message: string }[] = [];
  const engine = new StoryEngine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { formatVersion: 1, id: "t", entry: "a", columns } as any,
    { extensions },
  );
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") {
      errors.push({ code: e.payload.code, message: e.payload.message });
    }
  });
  return { engine, errors, off };
}

describe("op 注册表：注册期 fail-fast", () => {
  it("id 形态非法（大写 / 空 / 超长）→ 构造抛错", () => {
    for (const id of ["Demo", "", "a".repeat(33), "1abc", "a b"]) {
      expect(() => new StoryEngine({ formatVersion: 1, id: "t", entry: "a", columns: [] } as never, { extensions: [extension({ id })] }).start(), id).toThrow();
    }
  });

  it("op 名与内建冲突（say）→ 抛错（内建不可覆盖）", () => {
    const ext = extension({
      ops: [{ op: "say", exec: () => ({ ok: true }) }],
    });
    expect(
      () =>
        new StoryEngine(
          { formatVersion: 1, id: "t", entry: "a", columns: [] } as never,
          { extensions: [ext] },
        ),
    ).toThrow(/与内建 op 冲突/);
  });

  it("跨扩展 op 重名 → 抛错；stateVersion 非正 → 抛错", () => {
    const a = extension({ id: "demo_a" });
    const b = extension({ id: "demo_b" });
    expect(
      () =>
        new StoryEngine(
          { formatVersion: 1, id: "t", entry: "a", columns: [] } as never,
          { extensions: [a, b] },
        ),
    ).toThrow(/重复/);
    expect(
      () =>
        new StoryEngine(
          { formatVersion: 1, id: "t", entry: "a", columns: [] } as never,
          { extensions: [extension({ stateVersion: 0 })] },
        ),
    ).toThrow(/stateVersion/);
  });
});

describe("扩展 op 执行：状态进 SSOT + 前缀门卫", () => {
  it("注册的扩展 op 可执行：写入进 SSOT（ext.demo.* 命名空间）+ 随 ValueChanged/存档随行", () => {
    const { engine, errors, off } = makeEngine([extension()], [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "demo_counter", key: "runs" },
          { op: "demo_counter", key: "runs" },
          { op: "say", text: "完成" },
        ],
      },
    ]);
    const changes: string[] = [];
    const offState = engine.onStateChanged((c) => {
      if (c.key === "ext.demo.runs") changes.push(String(c.value));
    });
    engine.start();
    expect(engine.get("ext.demo.runs")).toBe(2); // 两次执行各 +1
    expect(changes).toEqual(["1", "2"]); // 经 SSOT → ValueChanged 镜像
    const save = engine.exportSave();
    // SaveDataV1.state = [key, value][]（整个 SSOT 的平面键值对）
    const savedRuns = (save?.state as [string, unknown][]).find(
      ([k]) => k === "ext.demo.runs",
    )?.[1];
    expect(savedRuns).toBe(2); // 随存档随行
    expect(errors).toEqual([]);
    offState();
    off();
    engine.dispose();
  });

  it("前缀门卫：ctx.set 物理强制 ext.<id>. 前缀（无前缀键物理不可达）", () => {
    const escaping = extension({
      ops: [
        {
          op: "demo_escape",
          exec: (_cmd, ctx) => {
            ctx.set("innocent", "经门卫落 ext.demo.innocent");
            return { ok: true };
          },
        },
      ],
    });
    const { engine, off } = makeEngine([escaping], [
      {
        id: "a",
        kind: "flow",
        commands: [{ op: "demo_escape" }, { op: "say", text: "x" }],
      },
    ]);
    engine.start();
    expect(engine.get("ext.demo.innocent")).toBe("经门卫落 ext.demo.innocent");
    expect(engine.get("innocent")).toBeUndefined(); // 无前缀键物理不存在
    const save = engine.exportSave();
    const savedKeys = (save?.state as [string, unknown][]).map(([k]) => k);
    expect(savedKeys).toContain("ext.demo.innocent");
    expect(savedKeys).not.toContain("innocent"); // 无前缀键不进存档
    off();
    engine.dispose();
  });

  it("值非法 → 引擎契约守卫（engine.error + 状态原样），与内建写入同一口径", () => {
    const bad = extension({
      ops: [
        {
          op: "demo_bad",
          exec: (_cmd, ctx) => {
            ctx.set("cfg", { at: new Date() }); // Date 非 JSON 安全
            return { ok: true };
          },
        },
      ],
    });
    const { engine, errors, off } = makeEngine([bad], [
      {
        id: "a",
        kind: "flow",
        commands: [{ op: "demo_bad" }, { op: "say", text: "x" }],
      },
    ]);
    engine.start();
    expect(errors.some((e) => e.message.includes("JSON") || e.code.length > 0)).toBe(true);
    expect(engine.get("ext.demo.cfg")).toBeUndefined(); // 状态原样（未写入）
    off();
    engine.dispose();
  });

  it("exec 失败（非 ok / 抛出）→ engine.error + 停在当前命令（后续不执行）", () => {
    const failing = extension({
      ops: [
        {
          op: "demo_fail",
          exec: () => ({ ok: false, code: "demo-failed", message: "扩展主动失败" }),
        },
        {
          op: "demo_throw",
          exec: () => {
            throw new Error("扩展炸了");
          },
        },
      ],
    });
    const { engine, errors, off } = makeEngine([failing], [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "demo_fail" },
          { op: "say", text: "不应到达" },
        ],
      },
    ]);
    engine.start();
    expect(errors.some((e) => e.code === "demo-failed")).toBe(true);
    expect(engine.get(SYS.waiting)).toBeUndefined(); // 循环停驻（未进入后续等待）
    off();
    engine.dispose();

    const thrown = makeEngine([failing], [
      {
        id: "a",
        kind: "flow",
        commands: [{ op: "demo_throw" }, { op: "say", text: "不应到达" }],
      },
    ]);
    thrown.engine.start();
    expect(thrown.errors.some((e) => e.code === "custom-op-threw")).toBe(true);
    thrown.off();
    thrown.engine.dispose();
  });

  it("未注册的扩展 op = unknown-op fail-closed（回归：口径不变）", () => {
    const { engine, errors, off } = makeEngine([], [
      {
        id: "a",
        kind: "flow",
        commands: [{ op: "no_such_op" }, { op: "say", text: "x" }],
      },
    ]);
    engine.start();
    expect(errors.some((e) => e.code === "unknown-op")).toBe(true);
    off();
    engine.dispose();
  });
});

describe("互锁：BUILTIN_OP_NAMES ↔ dispatch.ts 分发 case 集合精确相等", () => {
  it("分发 switch 的 case 全集 = 内建名清单（防漏搬/防漂移）", () => {
    const start = dispatchSource.indexOf("switch (cmd.op) {");
    const end = dispatchSource.indexOf("default:", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const dispatchCases = new Set(
      [
        ...dispatchSource
          .slice(start, end)
          .matchAll(/case "([^"]+)":/g),
      ].map((m) => m[1]!),
    );
    expect(dispatchCases).toEqual(BUILTIN_OP_NAMES);
  });
});

describe("拟态旅程：扩展状态随存档与回溯", () => {
  /** 三句旅程：两次 demo_counter 夹在 say 之间；检查点 0 = 首次解除（未计数）、1 = 计一次后 */
  const journey = [
    {
      id: "a",
      kind: "flow",
      commands: [
        { op: "say", text: "一" },
        { op: "demo_counter", key: "runs" },
        { op: "say", text: "二" },
        { op: "demo_counter", key: "runs" },
        { op: "say", text: "三" },
      ],
    },
  ];

  it("存档→读档：ext.demo.* 随档恢复（与内建状态无差别）", () => {
    const first = makeEngine([extension()], journey);
    first.engine.start();
    first.engine.advance();
    first.engine.advance();
    expect(first.engine.get("ext.demo.runs")).toBe(2);
    const data = first.engine.exportSave();
    expect(data).not.toBeNull();
    first.off();
    first.engine.dispose();

    const revived = makeEngine([extension()], journey);
    expect(
      revived.engine.importSave(
        JSON.parse(JSON.stringify(data)) as SaveDataV1,
      ),
    ).toBe(true);
    expect(revived.engine.get("ext.demo.runs")).toBe(2);
    revived.off();
    revived.engine.dispose();
  });

  it("回溯跨过扩展 op：值回到历史快照位（自定义状态与内建状态无差别）", () => {
    const { engine, off } = makeEngine([extension()], journey);
    engine.start();
    engine.advance(); // 检查点 0（runs 未计）→ demo_counter → runs = 1
    engine.advance(); // 检查点 1（runs = 1）→ demo_counter → runs = 2
    expect(engine.get("ext.demo.runs")).toBe(2);
    engine.rollbackTo(1); // 回到第一次计数后的等待位
    expect(engine.get("ext.demo.runs")).toBe(1);
    engine.rollbackTo(0); // 回到开场：demo_counter 从未执行
    expect(engine.get("ext.demo.runs")).toBeUndefined();
    off();
    engine.dispose();
  });
});
