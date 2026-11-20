/**
 * 玩家运动偏好倍率测试（转场/动画时长倍率、震动强度倍率、减少动态）。
 *
 * 核心不变量：偏好是**乘算/开关**，不改引擎里的描述值（SSOT 仍是作者写的时长与强度）。
 * 五类覆盖：多方位（三段各自倍率）、拟态旅程（改偏好下一帧生效）、故意错误（缺省不注入
 * 原样播放）、不变量（减少动态直达终值/幅度归零）、边界（speed 防 0、时长 0）。
 */
import { describe, expect, it } from "vitest";
import { resolveReducedMotion, type AnimationSpec } from "@lingfan-engine/core";
import {
  createVisualEffects,
  type MotionPreferences,
} from "@lingfan-engine/ui";

/** 可控事实源 + 记录触点：把每帧回调收集起来供断言 */
function harness() {
  const state = {
    animations: [] as AnimationSpec[],
    transition: undefined as { duration: number } | undefined,
    shake: undefined as { intensity: number; duration: number } | undefined,
  };
  const finished = { animation: [] as number[], transition: 0, shake: 0 };
  const frames = {
    animated: [] as { target: string; property: string; value: number }[],
    transition: [] as number[],
    transitionDone: 0,
    shake: [] as { x: number; y: number }[],
    shakeDone: 0,
  };
  const source = {
    animations: () => state.animations,
    transition: () => state.transition,
    shake: () => state.shake,
    animationFinished: (seq: number) => finished.animation.push(seq),
    transitionFinished: () => (finished.transition += 1),
    shakeFinished: () => (finished.shake += 1),
  };
  const animation = {
    onAnimatedProperty: (target: string, property: string, value: number) =>
      frames.animated.push({ target, property, value }),
  };
  const surface = {
    onTransitionFrame: (opacity: number) => frames.transition.push(opacity),
    onTransitionDone: () => (frames.transitionDone += 1),
    onShakeFrame: (x: number, y: number) => frames.shake.push({ x, y }),
    onShakeDone: () => (frames.shakeDone += 1),
  };
  return { state, finished, frames, source, animation, surface };
}

function spec(overrides: Partial<AnimationSpec> = {}): AnimationSpec {
  return {
    target: "el#1",
    property: "opacity",
    from: 0,
    to: 1,
    duration: 1,
    easing: "linear",
    seq: 1,
    ...overrides,
  };
}

describe("缺省不注入 = 原样播放（既有行为不变）", () => {
  it("转场按描述时长推进，1 秒时长两帧 0.5 才播毕", () => {
    const h = harness();
    h.state.transition = { duration: 1 };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
    });
    step(0.5);
    expect(h.finished.transition).toBe(0);
    step(0.5);
    expect(h.finished.transition).toBe(1);
  });
});

describe("transitionSpeed：时长倍率（>1 更快）", () => {
  it("speed=2 → 1 秒转场 0.5 秒播毕", () => {
    const h = harness();
    h.state.transition = { duration: 1 };
    const motion: MotionPreferences = {
      transitionSpeed: () => 2,
      shakeScale: () => 1,
      reducedMotion: () => false,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.5);
    expect(h.finished.transition).toBe(1);
  });

  it("元素动画 elapsed 乘 speed：speed=2 时 0.5 秒到终值", () => {
    const h = harness();
    h.state.animations = [spec({ duration: 1 })];
    const motion: MotionPreferences = {
      transitionSpeed: () => 2,
      shakeScale: () => 1,
      reducedMotion: () => false,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.5);
    expect(h.finished.animation).toEqual([1]);
    expect(h.frames.animated.at(-1)?.value).toBe(1);
  });
});

describe("shakeScale：震动强度倍率", () => {
  it("强度乘倍率（大幅值下舍入可忽略，幅值比 ≈ 倍率）", () => {
    const run = (scale: number): number => {
      const h = harness();
      h.state.shake = { intensity: 100, duration: 1 };
      const motion: MotionPreferences = {
        transitionSpeed: () => 1,
        shakeScale: () => scale,
        reducedMotion: () => false,
      };
      const step = createVisualEffects({
        source: h.source,
        animation: h.animation,
        surface: h.surface,
        motion,
      });
      step(0.1);
      const f = h.frames.shake[0];
      return Math.hypot(f?.x ?? 0, f?.y ?? 0);
    };
    const full = run(1);
    const half = run(0.5);
    expect(full).toBeGreaterThan(0);
    expect(half / full).toBeCloseTo(0.5, 1);
  });

  it("shakeScale=0 → 无位移（仍按时长收尾）", () => {
    const h = harness();
    h.state.shake = { intensity: 100, duration: 0.2 };
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 0,
      reducedMotion: () => false,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.1);
    expect(h.frames.shake[0]).toEqual({ x: 0, y: 0 });
    step(0.1);
    expect(h.finished.shake).toBe(1);
  });
});

describe("reducedMotion：减少动态（无障碍）", () => {
  it("动画首帧直达终值并交回", () => {
    const h = harness();
    h.state.animations = [spec({ duration: 5, from: 0, to: 1 })];
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 1,
      reducedMotion: () => true,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.016);
    expect(h.frames.animated[0]?.value).toBe(1);
    expect(h.finished.animation).toEqual([1]);
  });

  it("转场首帧即播毕（时长归零）", () => {
    const h = harness();
    h.state.transition = { duration: 5 };
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 1,
      reducedMotion: () => true,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.016);
    expect(h.finished.transition).toBe(1);
  });

  it("震动幅度归零但仍按时长收尾", () => {
    const h = harness();
    h.state.shake = { intensity: 100, duration: 0.2 };
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 1,
      reducedMotion: () => true,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.1);
    expect(h.frames.shake[0]).toEqual({ x: 0, y: 0 });
    expect(h.finished.shake).toBe(0);
    step(0.1);
    expect(h.finished.shake).toBe(1);
  });
});

describe("拟态旅程：改偏好下一帧即生效（逐帧现读）", () => {
  it("转场中途把 speed 从 1 调到 4，剩余时长按新倍率推进", () => {
    const h = harness();
    h.state.transition = { duration: 1 };
    let speed = 1;
    const motion: MotionPreferences = {
      transitionSpeed: () => speed,
      shakeScale: () => 1,
      reducedMotion: () => false,
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.25); // speed=1，已播 0.25/1
    expect(h.finished.transition).toBe(0);
    speed = 4; // 时长变 0.25，已播 0.25 → 下一帧即播毕
    step(0.016);
    expect(h.finished.transition).toBe(1);
  });
});

describe("reducedMotion 三态：玩家显式 > 系统偏好 > 内建关（系统层接线）", () => {
  /** 宿主同款合成闭包：player 显式覆盖系统；player 未设置跟随 system 读面（逐帧现读）。 */
  const reducedClosure = (
    player: boolean | undefined,
    system: () => boolean,
  ): (() => boolean) => {
    return () => resolveReducedMotion({ player, system: system() });
  };

  /** 有效减弱态 → 5 秒转场首帧即播毕；非减弱态 → 首帧未播毕。以此读有效值。 */
  const effectiveReduced = (
    player: boolean | undefined,
    system: () => boolean,
  ): boolean => {
    const h = harness();
    h.state.transition = { duration: 5 };
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 1,
      reducedMotion: reducedClosure(player, system),
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.016);
    return h.finished.transition === 1;
  };

  it("系统开 × 玩家未设置 → 跟随系统减弱（不再塌缩 false 跳过系统层）", () => {
    expect(effectiveReduced(undefined, () => true)).toBe(true);
  });

  it("系统关 × 玩家未设置 → 不减弱", () => {
    expect(effectiveReduced(undefined, () => false)).toBe(false);
  });

  it("玩家显式 true 覆盖系统关 → 减弱", () => {
    expect(effectiveReduced(true, () => false)).toBe(true);
  });

  it("玩家显式 false 覆盖系统开 → 不减弱", () => {
    expect(effectiveReduced(false, () => true)).toBe(false);
  });

  it("系统读面缺省（无测量注入）× 玩家未设置 → 内建关", () => {
    expect(resolveReducedMotion({})).toBe(false);
  });

  it("矩阵不变量：玩家显式恒赢系统（true/false × 系统开/关）", () => {
    for (const player of [true, false]) {
      for (const system of [true, false]) {
        expect(effectiveReduced(player, () => system)).toBe(player);
      }
    }
  });

  it("系统设置中途变化下一帧即生效（逐帧现读 system 读面）", () => {
    const h = harness();
    h.state.transition = { duration: 5 };
    let system = false;
    const motion: MotionPreferences = {
      transitionSpeed: () => 1,
      shakeScale: () => 1,
      reducedMotion: () => resolveReducedMotion({ player: undefined, system }),
    };
    const step = createVisualEffects({
      source: h.source,
      animation: h.animation,
      surface: h.surface,
      motion,
    });
    step(0.016); // 系统关 → 不减弱，未播毕
    expect(h.finished.transition).toBe(0);
    system = true; // 系统改为要求减弱 → 时长归零，下一帧即播毕
    step(0.016);
    expect(h.finished.transition).toBe(1);
  });
});
