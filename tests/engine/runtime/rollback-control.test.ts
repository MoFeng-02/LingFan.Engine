/**
 * 回退控制面测试（不可回溯叙事一等支持）。
 *
 * 测试要点：
 * - **工程级总开关**：rollbackEnabled=false 时 back/forward/rollbackTo 一律
 *   fail-closed 拒绝（engine.error rollback-disabled），状态原样；缺省 true 现行为不变。
 * - **op 级临时锁定**：block_rollback 设 SYS.rollbackLocked → 回退拒（rollback-locked）；
 *   fix_rollback 解锁 → 回退恢复。锁定是会话态，不进用户存档。
 * - **检查点策略**：rollbackEnabled=false 不建检查点（历史不无限增长），存读档照常。
 * - **历史容量上限**：非法值（NaN/负/非整数）降级默认 200 + 诊断；合法正整数原样。
 * - **fail-closed**：block_rollback/fix_rollback 未知负载字段拒绝，状态原样。
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan-engine/core";
import { StoryEngine, SYS } from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  errors: { code: string; message: string }[];
}

function makeEngine(
  columns: object[],
  options: { rollbackEnabled?: boolean; historyLimit?: number } = {},
): Harness {
  const errors: { code: string; message: string }[] = [];
  const engine = new StoryEngine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { formatVersion: 1, id: "t", entry: "a", columns } as any,
    options,
  );
  engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") {
      errors.push({ code: e.payload.code, message: e.payload.message });
    }
  });
  return { engine, errors };
}

/** 两句对话列：推进一句建一个检查点，供回退/历史容量断言 */
function talkColumns(): object[] {
  return [
    {
      id: "a",
      kind: "flow",
      commands: [
        { op: "say", text: "第一句" },
        { op: "say", text: "第二句" },
        { op: "say", text: "第三句" },
      ],
    },
  ];
}

describe("回退控制面：工程级总开关 rollbackEnabled", () => {
  it("缺省 true：back 照常回退（现行为不变，回归）", () => {
    const { engine, errors } = makeEngine(talkColumns());
    engine.start(); // 第一句
    engine.advance(); // 第二句
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    engine.back();
    expect(engine.get(SYS.currentDialogText)).toBe("第一句");
    expect(errors.filter((e) => e.code.startsWith("rollback"))).toHaveLength(0);
  });

  it("false：back/forward/rollbackTo 一律拒绝且状态原样", () => {
    const { engine, errors } = makeEngine(talkColumns(), {
      rollbackEnabled: false,
    });
    engine.start(); // 第一句
    engine.advance(); // 第二句
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    const cursorBefore = engine.historyCursor();

    engine.back();
    expect(engine.get(SYS.currentDialogText)).toBe("第二句"); // 状态原样
    engine.forward();
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    engine.rollbackTo(0);
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    expect(engine.historyCursor()).toBe(cursorBefore);

    const codes = errors.map((e) => e.code);
    expect(codes.filter((c) => c === "rollback-disabled")).toHaveLength(3);
  });

  it("false：不建检查点，历史不随推进无限增长", () => {
    const { engine } = makeEngine(talkColumns(), { rollbackEnabled: false });
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance();
    expect(engine.historyLength()).toBe(0);
  });

  it("false：存读档照常（存档不依赖回退能力）", () => {
    const { engine } = makeEngine(talkColumns(), { rollbackEnabled: false });
    engine.start();
    engine.advance();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    expect(save!.state.length).toBeGreaterThan(0);
  });
});

describe("回退控制面：op 级临时锁定 block_rollback / fix_rollback", () => {
  function lockColumns(): object[] {
    return [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "say", text: "第一句" },
          { op: "say", text: "第二句" },
          { op: "block_rollback" },
          { op: "say", text: "第三句" },
          { op: "fix_rollback" },
          { op: "say", text: "第四句" },
        ],
      },
    ];
  }

  it("锁定后回退拒（rollback-locked），解锁后恢复", () => {
    const { engine, errors } = makeEngine(lockColumns());
    engine.start(); // 第一句
    engine.advance(); // 第二句
    engine.advance(); // block_rollback（非阻塞）+ 第三句
    expect(engine.get(SYS.rollbackLocked)).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("第三句");
    engine.back(); // 锁定中 → 拒
    expect(engine.get(SYS.currentDialogText)).toBe("第三句");
    expect(errors.some((e) => e.code === "rollback-locked")).toBe(true);

    engine.advance(); // fix_rollback（非阻塞）+ 第四句
    expect(engine.get(SYS.rollbackLocked)).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toBe("第四句");
    engine.back(); // 解锁后 → 恢复
    expect(engine.get(SYS.currentDialogText)).toBe("第三句");
  });

  it("锁定是会话态：不进用户存档", () => {
    const { engine } = makeEngine(lockColumns());
    engine.start(); // 第一句
    engine.advance(); // 第二句
    engine.advance(); // block_rollback + 第三句
    expect(engine.get(SYS.rollbackLocked)).toBe(true);
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    const keys = save!.state.map(([k]) => k);
    expect(keys).not.toContain(SYS.rollbackLocked);
  });

  it("未知负载字段 fail-closed：拒绝且状态原样", () => {
    const { engine, errors } = makeEngine([
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "say", text: "第一句" },
          { op: "block_rollback", bogus: true } as StoryCommand,
        ],
      },
    ]);
    engine.start();
    engine.advance(); // 第一句
    engine.advance(); // block_rollback 带未知字段 → 拒
    expect(errors.some((e) => e.code === "block_rollback-unknown-field")).toBe(
      true,
    );
    expect(engine.get(SYS.rollbackLocked)).not.toBe(true); // 未写入
  });
});

describe("回退控制面：历史容量上限 historyLimit 信任边界", () => {
  it.each([Number.NaN, -1, 0, 1.5, Number.POSITIVE_INFINITY])(
    "非法值 %s → 降级默认 200 + 诊断（不静默）",
    (bad) => {
      const { engine, errors } = makeEngine(talkColumns(), {
        historyLimit: bad,
      });
      engine.start();
      expect(errors.some((e) => e.code === "history-limit-invalid")).toBe(true);
      // 降级到 200：推进远超 1 句仍能建检查点（若降级到 1 则历史封顶 1）
      engine.advance();
      engine.advance();
      expect(engine.historyLength()).toBeGreaterThanOrEqual(2);
    },
  );

  it("合法正整数原样采纳（historyLimit=1 历史封顶 1）", () => {
    const { engine, errors } = makeEngine(talkColumns(), { historyLimit: 1 });
    engine.start();
    expect(errors.some((e) => e.code === "history-limit-invalid")).toBe(false);
    engine.advance();
    engine.advance();
    engine.advance();
    expect(engine.historyLength()).toBe(1);
  });

  it("缺省不诊断（未配置≠非法）", () => {
    const { engine, errors } = makeEngine(talkColumns());
    engine.start();
    expect(errors.some((e) => e.code === "history-limit-invalid")).toBe(false);
  });
});
