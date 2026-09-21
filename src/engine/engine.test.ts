/**
 * 02-执行模型测试（规约↔测试互锁锚点）：
 * ssot-only-observation / race-stale-complete-flag / reset-clickable-after-say /
 * advance-only-in-dialog-wait / unknown-op-fail-closed
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "./contracts";
import { SYS } from "./contracts";
import { StoryEngine } from "./engine";
import { parseStory } from "./format";

function makeEngine(
  commands: object[],
  defines?: Record<string, unknown>,
): {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
} {
  const json: unknown = {
    formatVersion: 1,
    id: "demo",
    ...(defines === undefined ? {} : { defines }),
    columns: [{ id: "start", kind: "flow", commands }],
  };
  const engine = new StoryEngine(parseStory(json));
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
    },
  };
}

describe("StoryEngine 最小闭环主链路（锚点: ssot-only-observation）", () => {
  it("start + advance×3 走完三句 say，StateChanged 键序列精确匹配", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", speaker: "灵泛", text: "第一句" },
      { op: "say", text: "第二句" },
      { op: "say", speaker: "灵泛", text: "第三句" },
    ]);
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance();

    const expectedKeys = [
      SYS.currentSceneColumn,
      // say 1（进入等待前清残留完成标记——锚点: race-stale-complete-flag）
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 1（离开等待后清 clickable/noskip——锚点: reset-clickable-after-say）
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // say 2
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 2
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // say 3
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 3 → 列尾
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
    ];
    expect(changes.map((c) => c.key)).toEqual(expectedKeys);

    // 值抽查
    expect(changes[0]).toEqual({
      key: SYS.currentSceneColumn,
      value: "start",
      scope: "system",
    });
    expect(changes[2]?.value).toBe("灵泛");
    expect(changes[3]?.value).toBe("第一句");
    // say 2 无 speaker → 清空，不残留上一句（key 序列中的 idx12）
    expect(changes[12]?.key).toBe(SYS.currentDialogSpeaker);
    expect(changes[12]?.value).toBe("");
    expect(changes[13]?.value).toBe("第二句");
    // 末次 advance 后回到 none
    expect(changes[changes.length - 1]).toEqual({
      key: SYS.waiting,
      value: "none",
      scope: "system",
    });
    dispose();
  });

  it("say 进入等待时把残留的 __dialog_complete 清回 false（锚点: race-stale-complete-flag）", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    const firstWaitIdx = changes.findIndex((c) => c.key === SYS.waiting);
    engine.advance();
    // advance 置 complete=true 之后、下一句文本写入之前，必须有 complete=false 的清标记事件
    const afterAdvance = changes.slice(firstWaitIdx + 1);
    const completeTrueIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.dialogComplete,
    );
    const staleClearIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.dialogComplete && c.value === false,
    );
    const textIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.currentDialogText,
    );
    expect(completeTrueIdx).toBeGreaterThanOrEqual(0);
    expect(staleClearIdx).toBeGreaterThan(completeTrueIdx);
    expect(textIdx).toBeGreaterThan(staleClearIdx);
    dispose();
  });

  it("离开 say 等待后 clickable/noskip 复位（锚点: reset-clickable-after-say）", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", text: "甲", clickable: true, noskip: true },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    expect(engine.get(SYS.dialogClickable)).toBe(true);
    expect(engine.get(SYS.dialogNoskip)).toBe(true);
    engine.advance();
    expect(engine.get(SYS.dialogClickable)).toBe(false);
    expect(engine.get(SYS.dialogNoskip)).toBe(false);
    // 第二句未声明 → 保持 false，无泄漏
    expect(
      changes.filter((c) => c.key === SYS.dialogNoskip).at(-1)?.value,
    ).toBe(false);
    dispose();
  });
});

describe("命令面守卫（锚点: advance-only-in-dialog-wait）", () => {
  it("未启动时 advance 无效并报错", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.advance();
    expect(errors[0]?.payload.code).toBe("advance-invalid");
    dispose();
  });

  it("列尾（故事段结束）advance 无效并报错", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.start();
    engine.advance(); // 走完唯一一句 → 列尾
    engine.advance();
    expect(errors.at(-1)?.payload.code).toBe("advance-invalid");
    dispose();
  });
});

describe("fail-closed（锚点: unknown-op-fail-closed）", () => {
  it("未知 op → engine.error，不静默执行也不崩溃", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "teleport", target: " nowhere" },
    ]);
    engine.start();
    engine.advance();
    expect(errors[0]?.payload.code).toBe("unknown-op");
    expect(errors[0]?.payload.message).toContain("teleport");
    expect(errors[0]?.v).toBe(1);
    expect(engine.get(SYS.waiting)).toBe("none");
    // 未知 op 未产生任何状态写入
    expect(changes.filter((c) => c.key === "__teleport_target")).toHaveLength(
      0,
    );
    dispose();
  });

  it("say 负载未知字段 → engine.error 且零副作用", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "say", text: "甲", hacker: true },
    ]);
    engine.start();
    expect(errors[0]?.payload.code).toBe("say-unknown-field");
    // 先校验后写入：除列坐标外无任何对话键写入
    expect(changes.map((c) => c.key)).toEqual([SYS.currentSceneColumn]);
    expect(engine.get(SYS.currentDialogText)).toBeUndefined();
    dispose();
  });

  it("say 负载缺 text → engine.error", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "say", speaker: "灵泛" },
    ]);
    engine.start();
    expect(errors[0]?.payload.code).toBe("say-invalid");
    dispose();
  });
});

describe("defines（01 §一.6：顶层无条件 Set）", () => {
  it("start 时 defines 按序写入且先于列坐标", () => {
    const { engine, changes, dispose } = makeEngine(
      [{ op: "say", text: "甲" }],
      {
        "player.gold": 100,
        "npc.trust": 3,
      },
    );
    engine.start();
    expect(changes[0]).toEqual({
      key: "player.gold",
      value: 100,
      scope: "global",
    });
    expect(changes[1]).toEqual({ key: "npc.trust", value: 3, scope: "global" });
    expect(changes[2]?.key).toBe(SYS.currentSceneColumn);
    dispose();
  });
});

describe("重复 start", () => {
  it("第二次 start 报 already-started，不重置坐标", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.start();
    engine.start();
    expect(errors[0]?.payload.code).toBe("already-started");
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    dispose();
  });
});
