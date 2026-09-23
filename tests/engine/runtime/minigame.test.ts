/**
 * 06 §二/D5/F8 小游戏运行时测试：
 * - minigame-fail-closed-and-abortable（等待期可回溯：abort 信号 + 重放重新挂载）
 * - minigame-branching（on_success/on_fail 分流 + reward 走 ValueChanged 历史可溯）
 * - 故意错误：非等待期 resolve/畸形结果/坏负载全部 fail-closed 且状态原样
 * - 边界：reward {expr} 求值 + 重放确定性（rngState 随快照）、无分支原列继续、dispose abort
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  events: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const events: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => events.push(e));
  return {
    engine,
    changes,
    events,
    dispose: () => {
      offState();
      offEvent();
      engine.dispose();
    },
  };
}

function makeEngine(columns: object[], entry = "a"): Harness {
  return instrument(
    new StoryEngine(parseStory({ formatVersion: 1, id: "t", entry, columns })),
  );
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function mounts(h: Harness): Array<{
  game: string;
  config: Record<string, unknown>;
  signal: AbortSignal;
  seq: number;
}> {
  return h.events.flatMap((e) =>
    e.payload.kind === "minigame.mount" ? [e.payload] : [],
  );
}

function lastErrorCode(h: Harness): string | undefined {
  const last = h.events.at(-1);
  return last !== undefined && last.payload.kind === "engine.error"
    ? last.payload.code
    : undefined;
}

describe("minigame 生命周期（06 §二.1：执行 → 等待 → resolve → 分流）", () => {
  it("success：奖励写状态（state.updated 事件）+ on_success 分流（F8）", () => {
    const h = makeEngine([
      column("a", [
        {
          op: "minigame",
          game: "puzzle",
          config: { hp: 3 },
          on_success: "win",
          on_fail: "lose",
          reward: [{ key: "gold", value: 20 }],
        },
      ]),
      column("win", [{ op: "say", text: "通关" }]),
      column("lose", [{ op: "say", text: "失败" }]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("minigame");
    const [mount] = mounts(h);
    expect(mount?.game).toBe("puzzle");
    expect(mount?.config).toEqual({ hp: 3 });
    expect(mount?.signal.aborted).toBe(false);
    expect(h.engine.get(SYS.minigame)).toMatchObject({
      game: "puzzle",
      seq: 1,
    });
    expect(h.engine.resolveMinigame({ outcome: "success", score: 99 })).toBe(
      true,
    );
    expect(h.changes.some((c) => c.key === "gold" && c.value === 20)).toBe(
      true,
    );
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("win");
    expect(h.engine.get(SYS.currentDialogText)).toBe("通关");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    expect(mounts(h)).toHaveLength(1);
    h.dispose();
  });

  it("fail：不写奖励 + on_fail 分流", () => {
    const h = makeEngine([
      column("a", [
        {
          op: "minigame",
          game: "puzzle",
          on_success: "win",
          on_fail: "lose",
          reward: [{ key: "gold", value: 20 }],
        },
      ]),
      column("win", [{ op: "say", text: "通关" }]),
      column("lose", [{ op: "say", text: "失败" }]),
    ]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "fail" })).toBe(true);
    expect(h.engine.get("gold")).toBeUndefined();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("lose");
    h.dispose();
  });

  it("无分支目标 = 原列继续（reward 照写）", () => {
    const h = makeEngine([
      column("a", [
        { op: "minigame", game: "puzzle", reward: [{ key: "gold", value: 5 }] },
        { op: "say", text: "继续" },
      ]),
    ]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true);
    expect(h.engine.get("gold")).toBe(5);
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("a");
    expect(h.engine.get(SYS.currentDialogText)).toBe("继续");
    h.dispose();
  });
});

describe("等待期可回溯（D5：minigame-fail-closed-and-abortable）", () => {
  it("中断挂载 abort + 重放重新挂载（新 seq 新 signal）：back 到小游戏检查点即重放", () => {
    const h = makeEngine([
      column("a", [
        { op: "minigame", game: "puzzle" },
        { op: "say", text: "之后" },
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("minigame");
    const first = mounts(h).at(-1)!;
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true); // 推进到 say（挂载已收尾，控制器清空）
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.engine.back(); // 回到小游戏检查点 → 重放重新执行 minigame
    const again = mounts(h).at(-1)!;
    expect(again.seq).toBeGreaterThan(first.seq); // 重放重新挂载
    expect(again.signal).not.toBe(first.signal);
    expect(again.signal.aborted).toBe(false);
    expect(h.engine.get(SYS.waiting)).toBe("minigame");
    h.dispose();
  });

  it("dispose/navigate 中断挂载并拒绝迟到的 resolve", () => {
    const h = makeEngine([column("a", [{ op: "minigame", game: "p" }])]);
    h.engine.start();
    const [mount] = mounts(h);
    h.engine.dispose();
    expect(mount?.signal.aborted).toBe(true);
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(false);
    h.dispose();
  });

  it("navigate 打断小游戏等待并切列", () => {
    const h = makeEngine([
      column("a", [{ op: "minigame", game: "p" }]),
      column("b", [{ op: "say", text: "乙" }]),
    ]);
    h.engine.start();
    h.engine.navigate("b");
    expect(mounts(h)[0]?.signal.aborted).toBe(true);
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    expect(h.engine.get(SYS.currentDialogText)).toBe("乙");
    h.dispose();
  });
});

describe("故意错误：fail-closed 且状态原样", () => {
  it("非等待期 resolve 被拒", () => {
    const h = makeEngine([column("a", [{ op: "say", text: "x" }])]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(false);
    expect(lastErrorCode(h)).toBe("minigame-resolve-invalid");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("畸形结果（坏 outcome / 非有限 score）被拒且等待保持", () => {
    const h = makeEngine([column("a", [{ op: "minigame", game: "p" }])]);
    h.engine.start();
    for (const bad of [
      null,
      "success",
      { outcome: "win" },
      { outcome: 1 },
      { outcome: "success", score: Number.NaN },
      { outcome: "success", score: Number.POSITIVE_INFINITY },
    ]) {
      expect(h.engine.resolveMinigame(bad as never)).toBe(false);
      expect(lastErrorCode(h)).toBe("minigame-result-invalid");
      expect(h.engine.get(SYS.waiting)).toBe("minigame");
    }
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true);
    h.dispose();
  });

  it("坏负载 fail-closed（未知字段/空 game/config 数组/reward 畸形）", () => {
    const base = { op: "minigame", game: "p" };
    const badPayloads = [
      { ...base, extra: 1 },
      { op: "minigame", game: "" },
      { op: "minigame", game: "p", config: [1] },
      { op: "minigame", game: "p", on_success: "" },
      { op: "minigame", game: "p", reward: "x" },
      { op: "minigame", game: "p", reward: [{ key: "", value: 1 }] },
      { op: "minigame", game: "p", reward: [{ key: "gold" }] },
    ];
    for (const bad of badPayloads) {
      // 直构 Story（绕过 parse 层）——负载级 fail-closed 是执行器职责（parse 层拒绝由互锁测试覆盖）
      const h = instrument(
        new StoryEngine({
          formatVersion: 1,
          id: "t",
          entry: "a",
          columns: [column("a", [bad as object])],
        } as never),
      );
      h.engine.start();
      expect(
        h.engine.get(SYS.waiting) === "minigame",
        JSON.stringify(bad),
      ).toBe(false); // 等待未建立（键缺省 undefined）
      expect(lastErrorCode(h), JSON.stringify(bad)).toMatch(/^minigame/);
      h.dispose();
    }
    // reward.value 表达式错误：沿用通用 ExpressionError 码（S5 语义，非 minigame 专属）
    const h = instrument(
      new StoryEngine({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          column("a", [
            {
              op: "minigame",
              game: "p",
              reward: [{ key: "g", value: "{undefined_var}" }],
            },
          ]),
        ],
      } as never),
    );
    h.engine.start();
    expect(lastErrorCode(h)).toBe("unknown-variable");
    h.dispose();
  });

  it("目标列不存在 = fail-closed（奖励已写、等待解除、run 停机）", () => {
    const h = makeEngine([
      column("a", [{ op: "minigame", game: "p", on_success: "ghost" }]),
    ]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(false);
    expect(lastErrorCode(h)).toBe("unknown-column");
    expect(h.engine.get(SYS.waiting)).toBe("none");
    h.dispose();
  });
});

describe("边界条件", () => {
  it("reward value 支持 {expr}（含插值变量）", () => {
    const h = makeEngine([
      column("a", [
        { op: "set", key: "base", value: 10 },
        {
          op: "minigame",
          game: "p",
          reward: [{ key: "gold", value: "{base * 2}" }],
        },
        { op: "say", text: "x" },
      ]),
    ]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true);
    expect(h.engine.get("gold")).toBe(20);
    h.dispose();
  });

  it("reward 引用既有变量：回溯重放取恢复的状态值（确定性来自 R6 显式种子的 random op，而非未种子化 random）", () => {
    const build = () =>
      makeEngine([
        column("a", [
          { op: "random", seed: 42, range: [1, 999], var: "r" },
          {
            op: "minigame",
            game: "p",
            reward: [{ key: "roll", value: "{r}" }],
          },
          { op: "say", text: "x" },
        ]),
      ]);
    const first = build();
    first.engine.start();
    first.engine.resolveMinigame({ outcome: "success" });
    const rolled = first.engine.get("roll");
    expect(rolled).toBe(601); // seed 42 → 首抽确定（mulberry32，回归锚定）
    first.dispose();
    // back 回到小游戏检查点 → 重放重新执行 minigame（random op 不重执行）：
    // reward {r} 读恢复的状态值 → 同值；重新挂载后 resolve 再次写同值
    const second = build();
    second.engine.start();
    second.engine.resolveMinigame({ outcome: "success" });
    second.engine.back();
    expect(mounts(second).length).toBe(2); // 重放重新挂载
    second.engine.resolveMinigame({ outcome: "success" });
    expect(second.engine.get("roll")).toBe(rolled);
    second.dispose();
  });

  it("reward 空数组 = 合法 no-op；config 缺省 = 空对象透传", () => {
    const h = makeEngine([
      column("a", [
        { op: "minigame", game: "p", reward: [] },
        { op: "say", text: "x" },
      ]),
    ]);
    h.engine.start();
    expect(mounts(h)[0]?.config).toEqual({});
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true);
    expect(h.engine.get(SYS.currentDialogText)).toBe("x");
    h.dispose();
  });

  it("双 resolve：第二次被拒（等待已解除）", () => {
    const h = makeEngine([column("a", [{ op: "minigame", game: "p" }])]);
    h.engine.start();
    expect(h.engine.resolveMinigame({ outcome: "success" })).toBe(true);
    expect(h.engine.resolveMinigame({ outcome: "fail" })).toBe(false);
    expect(lastErrorCode(h)).toBe("minigame-resolve-invalid");
    h.dispose();
  });
});
