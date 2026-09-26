/**
 * 08 §二.2 帧驱动表现的纯逻辑（可测）：缓动映射、动画插值、震动偏移。
 *
 * 分工：核心层写「描述」，本模块提供**每帧计算**，宿主（App.vue / 其他）把结果写到 DOM。
 * 不碰引擎、不碰 DOM —— 便于单测覆盖（08 §三.2 帧驱动）。
 */
import type { AnimationSpec } from "@lingfan/engine";

/**
 * 缓动名 → 归一化函数（`t ∈ [0,1] → [0,1]`）。
 * 命名对齐老引擎（默认 `EaseOutQuad`）；未知名字**回退 EaseOutQuad**（不静默变成线性）。
 */
const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  EaseInQuad: (t) => t * t,
  EaseOutQuad: (t) => t * (2 - t),
  EaseInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  EaseInCubic: (t) => t * t * t,
  EaseOutCubic: (t) => 1 - (1 - t) ** 3,
  EaseInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
};

const DEFAULT_EASING = "EaseOutQuad";

export function easingFn(name: string): (t: number) => number {
  return EASINGS[name] ?? EASINGS[DEFAULT_EASING]!;
}

/** 已知缓动名（编辑器表单/诊断可枚举；不含回退项） */
export function easingNames(): string[] {
  return Object.keys(EASINGS);
}

/**
 * 单条动画在 `elapsed`（秒）时刻的插值。
 * `done=true` 表示已到终值（宿主据此把该 seq 交回 `engine.animationFinished`）。
 */
export function interpolateAnimation(
  spec: AnimationSpec,
  elapsed: number,
): { value: number; done: boolean } {
  if (spec.duration <= 0) return { value: spec.to, done: true };
  const t = Math.min(1, Math.max(0, elapsed / spec.duration));
  const value = spec.from + (spec.to - spec.from) * easingFn(spec.easing)(t);
  return { value, done: t >= 1 };
}

/**
 * 屏幕震动偏移（老引擎每帧由 GameLoop 算 offset）。
 * 用**衰减正弦**近似：幅度随进度线性衰减到 0，x/y 取不同相位避免直线往复。
 * `phase` 为宿主传入的帧时间（秒）或随机源，保证同一输入可复现（测试友好）。
 */
export function shakeOffset(
  intensity: number,
  progress: number,
  phase: number,
): { x: number; y: number } {
  const decay = Math.max(0, 1 - progress);
  const amplitude = intensity * decay;
  // `|| 0` 归一化 -0（Math.round 可产出 -0，会让相等断言与 style 序列化不一致）
  return {
    x: Math.round(Math.sin(phase * 47) * amplitude) || 0,
    y: Math.round(Math.cos(phase * 61) * amplitude) || 0,
  };
}

/** 转场遮罩不透明度（`fade` 系）：0 → 1 → 0 的三段式（中点为全遮） */
export function transitionOpacity(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t <= 0.5 ? t * 2 : (1 - t) * 2;
}
