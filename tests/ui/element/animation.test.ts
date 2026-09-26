/**
 * 08 §二.2 帧驱动纯逻辑测试（缓动 / 插值 / 震动 / 转场透明度）。
 * 锚点: element-animate-frame
 */
import { describe, expect, it } from "vitest";
import type { AnimationSpec } from "@lingfan/engine";
import {
  easingFn,
  easingNames,
  interpolateAnimation,
  shakeOffset,
  transitionOpacity,
} from "@lingfan/ui";

function spec(partial: Partial<AnimationSpec> = {}): AnimationSpec {
  return {
    target: "e1",
    property: "opacity",
    from: 0,
    to: 1,
    duration: 1,
    easing: "linear",
    seq: 1,
    ...partial,
  };
}

describe("easingFn", () => {
  it("已知名返回对应函数；未知名回退 EaseOutQuad（不静默变线性）", () => {
    expect(easingFn("linear")(0.5)).toBeCloseTo(0.5);
    expect(easingFn("不存在的缓动")(0.5)).toBeCloseTo(0.5 * (2 - 0.5));
    expect(easingNames()).toContain("EaseOutQuad");
  });
});

describe("interpolateAnimation（锚点: element-animate-frame）", () => {
  it("按 elapsed 插值；到时 done=true 且取终值；越界夹紧", () => {
    const s = spec();
    expect(interpolateAnimation(s, 0)).toEqual({ value: 0, done: false });
    expect(interpolateAnimation(s, 0.5)).toEqual({ value: 0.5, done: false });
    expect(interpolateAnimation(s, 1)).toEqual({ value: 1, done: true });
    expect(interpolateAnimation(s, 2)).toEqual({ value: 1, done: true });
  });

  it("duration=0 → 立即完成取终值", () => {
    expect(interpolateAnimation(spec({ duration: 0 }), 0)).toEqual({
      value: 1,
      done: true,
    });
  });

  it("from > to 可反向插值", () => {
    const back = spec({ from: 1, to: 0 });
    expect(interpolateAnimation(back, 0.25)).toEqual({
      value: 0.75,
      done: false,
    });
  });
});

describe("shakeOffset", () => {
  it("幅度随进度衰减到 0（progress=1 → 无偏移）", () => {
    expect(shakeOffset(10, 1, 0.1)).toEqual({ x: 0, y: 0 });
  });

  it("同输入可复现（确定性，便于测试与重放）", () => {
    expect(shakeOffset(10, 0.3, 0.7)).toEqual(shakeOffset(10, 0.3, 0.7));
  });

  it("开始时有偏移", () => {
    const first = shakeOffset(10, 0, 0.13);
    expect(Math.abs(first.x) + Math.abs(first.y)).toBeGreaterThan(0);
  });
});

describe("transitionOpacity", () => {
  it("三段式：0 → 1（中点全遮）→ 0", () => {
    expect(transitionOpacity(0)).toBe(0);
    expect(transitionOpacity(0.5)).toBe(1);
    expect(transitionOpacity(1)).toBe(0);
  });
});
