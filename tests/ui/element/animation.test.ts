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

  it("全集 = 老引擎 EasingType 16 个（T01-04 补齐 Back/Elastic/Bounce 共 9 个）", () => {
    // 来源：老引擎 `Abstractions/.../EasingType.cs`（Linear + Quad×3 + Cubic×3 + Back×3 + Elastic×3 + Bounce×3）
    expect([...easingNames()].sort()).toEqual(
      [
        "Linear",
        "EaseInQuad",
        "EaseOutQuad",
        "EaseInOutQuad",
        "EaseInCubic",
        "EaseOutCubic",
        "EaseInOutCubic",
        "EaseInBack",
        "EaseOutBack",
        "EaseInOutBack",
        "EaseInElastic",
        "EaseOutElastic",
        "EaseInOutElastic",
        "EaseInBounce",
        "EaseOutBounce",
        "EaseInOutBounce",
      ].sort(),
    );
  });

  it("大小写不敏感：老引擎写法 Linear 与既有语料 linear 等价（回归锚定）", () => {
    expect(easingFn("Linear")(0.3)).toBeCloseTo(easingFn("linear")(0.3));
    expect(easingFn("easeoutquad")(0.4)).toBeCloseTo(easingFn("EaseOutQuad")(0.4));
  });

  it("每个缓动都是归一化函数：f(0)=0、f(1)=1（边界）", () => {
    for (const name of easingNames()) {
      expect(easingFn(name)(0), `${name}(0)`).toBeCloseTo(0);
      expect(easingFn(name)(1), `${name}(1)`).toBeCloseTo(1);
    }
  });

  it("补齐族取值照老引擎公式（关键点核对，不是等价改写）", () => {
    // Back：超调族（Out 在收尾段冲过 1）
    expect(easingFn("EaseInBack")(0.5)).toBeCloseTo(
      0.5 * 0.5 * (2.70158 * 0.5 - 1.70158),
    );
    expect(easingFn("EaseOutBack")(0.75)).toBeGreaterThan(1);
    // Elastic：老引擎 t==0 / t==1 特判走原值（不是 0/1 之外的抖动）
    expect(easingFn("EaseInElastic")(0)).toBe(0);
    expect(easingFn("EaseInElastic")(1)).toBe(1);
    expect(easingFn("EaseOutElastic")(0)).toBe(0);
    // Bounce：分段基函数（t=1 收敛到 1，且首个分段边界值 = 7.5625*(1/2.75)²）
    expect(easingFn("EaseOutBounce")(1)).toBeCloseTo(1);
    const t1 = 1 / 2.75;
    expect(easingFn("EaseOutBounce")(t1)).toBeCloseTo(7.5625 * t1 * t1);
    expect(easingFn("EaseInBounce")(0)).toBeCloseTo(0);
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
