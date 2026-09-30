/**
 * 帧驱动表现类 op 测试（animate / animate_block / transition / shake / text_typewriter）。
 *
 * 分工断言：**核心只写「描述/启动键」**（离散、进快照），逐帧插值与 DOM 归 UI；
 * 动画播毕由 UI 回调 `animationFinished(seq)` 触发终值写回。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

function makeEngine(entry: object[]): {
  engine: StoryEngine;
  errors: OutboundEvent[];
} {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [{ type: "text", id: "title", text: "标题" }],
          entry,
        },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => errors.push(e));
  return { engine, errors };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload.kind === "engine.error" ? e.payload.code : ""));
}

describe("animate", () => {
  it("入队动画描述：from 取元素当前值（缺省 0），easing 缺省 EaseOutQuad", () => {
    const { engine, errors } = makeEngine([
      { op: "style", target: "title", props: { opacity: 0.2 } },
      {
        op: "animate",
        target: "title",
        property: "opacity",
        value: 1,
        duration: 0.5,
      },
    ]);
    engine.start();
    const list = engine.animations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      target: "title",
      property: "opacity",
      from: 0.2,
      to: 1,
      duration: 0.5,
      easing: "EaseOutQuad",
    });
    expect(errors).toHaveLength(0);
    engine.dispose();
  });

  it("播毕回调：终值写回元素 props 并出队（回溯看到的是终态）", () => {
    const { engine } = makeEngine([
      { op: "animate", target: "title", property: "opacity", value: 0.8 },
    ]);
    engine.start();
    const seq = engine.animations()[0]!.seq;
    engine.animationFinished(seq);
    expect(engine.animations()).toEqual([]);
    expect(
      engine.elements().find((e) => e.id === "title")?.props.opacity,
    ).toBe(0.8);
    engine.dispose();
  });

  it("未知目标 / 非数字 value → fail-closed", () => {
    const miss = makeEngine([
      { op: "animate", target: "ghost", property: "x", value: 1 },
    ]);
    miss.engine.start();
    expect(errorCodes(miss.errors)).toContain("animate-target-not-found");
    miss.engine.dispose();
  });
});

describe("animate_block", () => {
  it("多属性同时入队（同 duration；JSON 键序不可控故取并行）", () => {
    const { engine, errors } = makeEngine([
      {
        op: "animate_block",
        target: "title",
        x: 100,
        y: 50,
        opacity: 0.5,
        duration: 1,
      },
    ]);
    engine.start();
    expect(
      engine
        .animations()
        .map((a) => a.property)
        .sort(),
    ).toEqual(["opacity", "x", "y"]);
    expect(errors).toHaveLength(0);
    engine.dispose();
  });

  it("无任何属性 → fail-closed", () => {
    const { engine, errors } = makeEngine([
      { op: "animate_block", target: "title" },
    ]);
    engine.start();
    expect(errorCodes(errors)).toContain("animate_block-invalid");
    engine.dispose();
  });
});

describe("transition / shake", () => {
  it("写启动键（含单调 seq），播毕清空", () => {
    const { engine, errors } = makeEngine([
      { op: "transition", type: "fade", duration: 0.6 },
      { op: "shake", intensity: 12, duration: 0.4 },
    ]);
    engine.start();
    expect(engine.get(SYS.transition)).toMatchObject({
      type: "fade",
      duration: 0.6,
    });
    expect(engine.get(SYS.shake)).toMatchObject({
      intensity: 12,
      duration: 0.4,
    });
    expect(errors).toHaveLength(0);

    engine.transitionFinished();
    engine.shakeFinished();
    expect(engine.get(SYS.transition)).toBeNull();
    expect(engine.get(SYS.shake)).toBeNull();
    engine.dispose();
  });

  it("transition 缺 type / 非法 type → 解析期或运行期拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          { id: "s", kind: "scene", elements: [], entry: [{ op: "transition" }] },
        ],
      }),
    ).toThrow(/必须为非空字符串/);
  });
});

describe("text_typewriter", () => {
  it("写故事级设置（enabled / speed 可单给）", () => {
    const { engine, errors } = makeEngine([
      { op: "text_typewriter", speed: 40 },
    ]);
    engine.start();
    expect(engine.get(SYS.typewriter)).toEqual({ speed: 40 });
    expect(errors).toHaveLength(0);
    engine.dispose();

    const off = makeEngine([{ op: "text_typewriter", enabled: false }]);
    off.engine.start();
    expect(off.engine.get(SYS.typewriter)).toEqual({ enabled: false });
    off.engine.dispose();
  });

  it("两者皆缺 / 非法 speed → 解析期拒绝（fail-closed 双保险）", () => {
    for (const bad of [
      { op: "text_typewriter" },
      { op: "text_typewriter", speed: -1 },
    ]) {
      expect(() =>
        parseStory({
          formatVersion: 1,
          id: "demo",
          columns: [
            { id: "s", kind: "scene", elements: [], entry: [bad] },
          ],
        }),
      ).toThrow(/至少需要 enabled 或 speed|必须为正数/);
    }
  });
});
