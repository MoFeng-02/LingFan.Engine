/**
 * text_typewriter 合并写：原子性、帧级键不入事件流、二段式前提不破坏。
 *
 * 合并写的判据是「只写本次给出的字段」：先 enabled 后 speed，两个都在；
 * 反过来先 speed 后 enabled 也一样。整对象替换会把先写的那个丢掉。
 * 帧级键（转场进度 / 打字机游标）由宿主每帧直读，永远不该出现在 ValueChanged 里；
 * 配置键（__typewriter / __transition / __shake）则正常出站。
 * 二段式的引擎侧前提：say 上屏即等待且完成标记为 false，advance 才置 true 并推进。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, ValueChanged } from "@lingfan-engine/core";
import { parseStory, StoryEngine, SYS } from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  changes: ValueChanged[];
  dispose: () => void;
}

function makeEngine(commands: object[]): Harness {
  const errors: OutboundEvent[] = [];
  const changes: ValueChanged[] = [];
  const story = parseStory({
    formatVersion: 1,
    id: "typewriter",
    columns: [{ id: "start", kind: "flow", commands }],
  });
  const engine = new StoryEngine(story, { rngSeed: 3 });
  const offEvent = engine.onEvent((e) => errors.push(e));
  const offState = engine.onStateChanged((c) => changes.push(c));
  engine.start();
  return {
    engine,
    errors,
    changes,
    dispose: () => {
      offEvent();
      offState();
      engine.dispose();
    },
  };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload as { code: string }).code);
}

function typewriter(engine: StoryEngine): Record<string, unknown> {
  return (engine.get(SYS.typewriter) ?? {}) as Record<string, unknown>;
}

describe("合并写：只更新本次给出的字段", () => {
  it("typewriter-atomic-write：先 enabled 后 speed，两者都保留", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "text_typewriter", enabled: true },
      { op: "text_typewriter", speed: 40 },
      { op: "say", text: "停" },
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    expect(typewriter(engine)).toEqual({ enabled: true, speed: 40 });
    dispose();
  });

  it("typewriter-atomic-write：先 speed 后 enabled，两者都保留", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "text_typewriter", speed: 25 },
      { op: "text_typewriter", enabled: false },
      { op: "say", text: "停" },
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    expect(typewriter(engine)).toEqual({ speed: 25, enabled: false });
    dispose();
  });

  it("typewriter-atomic-write：单次写入只发一条 __typewriter 变更", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "text_typewriter", enabled: true },
      { op: "text_typewriter", speed: 40 },
      { op: "say", text: "停" },
    ]);
    const typewriterChanges = changes.filter((c) => c.key === SYS.typewriter);
    expect(typewriterChanges).toHaveLength(2);
    expect(typewriterChanges[1]!.value).toEqual({ enabled: true, speed: 40 });
    expect(engine.get(SYS.waiting)).toBe("dialog");
    dispose();
  });
});

describe("帧级键不入事件流", () => {
  it("typewriter-frame-keys-not-events：配置键出站，进度/游标键永不 emit", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "text_typewriter", enabled: true, speed: 30 },
      { op: "transition", type: "fade" },
      { op: "shake" },
      { op: "say", text: "停" },
    ]);
    engine.advance();
    const keys = new Set(changes.map((c) => c.key));
    expect(keys.has(SYS.typewriter)).toBe(true);
    expect(keys.has(SYS.transition)).toBe(true);
    expect(keys.has(SYS.shake)).toBe(true);
    for (const key of keys) {
      expect(key).not.toMatch(/progress|elapsed|cursor/);
    }
    expect(keys.has("__transition_progress")).toBe(false);
    expect(keys.has("__transition_elapsed")).toBe(false);
    dispose();
  });
});

describe("二段式的引擎侧前提不破坏", () => {
  it("typewriter-two-stage：say 上屏等待且未完成，advance 置完成并推进", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "text_typewriter", enabled: true },
      { op: "text_typewriter", speed: 30 },
      { op: "say", text: "第一句" },
      { op: "say", text: "第二句" },
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.dialogComplete)).toBe(false);
    expect(engine.get(SYS.currentDialogText)).toBe("第一句");
    engine.advance();
    // 推进到下一句：下一句上屏又把完成标记复位为 false（二段式逐句重置）
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.dialogComplete)).toBe(false);
    dispose();
  });

  it("typewriter-two-stage：instant / typewriter=false 行参原样接受", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "text_typewriter", enabled: true, speed: 30 },
      { op: "say", text: "瞬完", instant: true },
      { op: "say", text: "无打字机", typewriter: false },
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("瞬完");
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("无打字机");
    dispose();
  });
});
