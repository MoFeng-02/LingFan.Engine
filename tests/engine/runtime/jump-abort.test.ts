/**
 * `jump` 换列中断外部接管（jump-aborts-takeover / abort-single-exit / advance-key-not-stuck）。
 *
 * 语义要点：
 * - `jump` 经 `enterColumn` 换列，与 navigate/回溯/读档/销毁共用同一个中断收尾
 *   （`abortExternalTakeovers`）：接管等待期被 jump 跨列 ⇒ 挂载信号 abort，宿主据此卸载。
 * - 单一收尾：正常完成（resolve 后自行清控制器再 enterColumn）不 abort 自己的挂载——
 *   收尾函数对已清空的控制器是幂等空操作，不会误伤正常完成。
 * - 中断后推进键不失效：jump 落到新列的 say 等待点，advance 照常推进。
 * - 故意错误：jump 到未知列 fail-closed（整份回滚、状态原样），不 abort 接管信号。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

function makeEngine(
  entry: object[],
  landing: object[] = [{ op: "say", text: "落点" }],
): { engine: StoryEngine; events: OutboundEvent[]; errors: OutboundEvent[] } {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        { id: "s", kind: "flow", commands: entry },
        { id: "ok", kind: "flow", commands: landing },
      ],
    }),
  );
  const events: OutboundEvent[] = [];
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => {
    events.push(e);
    if (e.payload.kind === "engine.error") errors.push(e);
  });
  engine.start();
  return { engine, events, errors };
}

function mountSignal(events: OutboundEvent[], kind: string) {
  const hit = events.find((e) => e.payload.kind === kind);
  return hit && "signal" in hit.payload ? hit.payload.signal : undefined;
}

describe("jump 换列中断接管（jump-aborts-takeover）", () => {
  it("interaction 等待期 submit jump 跨列 ⇒ 挂载信号 abort", () => {
    const { engine, events } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    expect(engine.get(SYS.waiting)).toBe("interaction");
    const signal = mountSignal(events, "interaction.mount")!;
    expect(signal.aborted).toBe(false);
    expect(engine.submitSceneOps([{ op: "jump", target: "ok" }])).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(engine.get(SYS.waiting)).not.toBe("interaction");
  });

  it("minigame 等待期 submit jump 跨列 ⇒ 挂载信号 abort", () => {
    const { engine, events } = makeEngine([{ op: "minigame", game: "p" }]);
    expect(engine.get(SYS.waiting)).toBe("minigame");
    const signal = mountSignal(events, "minigame.mount")!;
    expect(signal.aborted).toBe(false);
    expect(engine.submitSceneOps([{ op: "jump", target: "ok" }])).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(engine.get(SYS.waiting)).not.toBe("minigame");
  });

  it("jump 与 navigate 走同一中断收尾（都 abort 接管信号）", () => {
    const a = makeEngine([{ op: "interaction", system: "walk" }]);
    const sa = mountSignal(a.events, "interaction.mount")!;
    a.engine.submitSceneOps([{ op: "jump", target: "ok" }]);
    const b = makeEngine([{ op: "interaction", system: "walk" }]);
    const sb = mountSignal(b.events, "interaction.mount")!;
    b.engine.navigate("ok");
    expect(sa.aborted).toBe(true);
    expect(sb.aborted).toBe(true);
  });
});

describe("jump 中断单一收尾（abort-single-exit）", () => {
  it("正常完成不 abort 自己的挂载（收尾对已清控制器幂等空操作）", () => {
    const { engine, events } = makeEngine([
      { op: "interaction", system: "walk", on_success: "ok" },
    ]);
    const signal = mountSignal(events, "interaction.mount")!;
    expect(engine.resolveInteraction("walk", { outcome: "success" })).toBe(
      true,
    );
    // 完成转列经 enterColumn 同一收尾，但控制器已先清空 ⇒ 不误伤正常完成
    expect(signal.aborted).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toContain("落点");
  });
});

describe("jump 中断后推进键不失效（advance-key-not-stuck）", () => {
  it("jump 落到新列 say 等待点，advance 照常推进", () => {
    const { engine, events } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    const signal = mountSignal(events, "interaction.mount")!;
    engine.submitSceneOps([{ op: "jump", target: "ok" }]);
    expect(signal.aborted).toBe(true);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toContain("落点");
    // 推进键照常消费对话等待（typewriter 两阶段也兜得住）：离开 dialog 即未卡死
    engine.advance();
    engine.advance();
    expect(engine.get(SYS.waiting)).not.toBe("dialog");
  });
});

describe("jump 故意错误（fail-closed 状态原样）", () => {
  it("jump 到未知列 ⇒ 整份回滚、不 abort 接管、仍在原等待", () => {
    const { engine, events, errors } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    const signal = mountSignal(events, "interaction.mount")!;
    expect(engine.submitSceneOps([{ op: "jump", target: "ghost" }])).toBe(
      false,
    );
    expect(signal.aborted).toBe(false);
    expect(engine.get(SYS.waiting)).toBe("interaction");
    expect(
      errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "unknown-column",
      ),
    ).toBe(true);
  });
});
