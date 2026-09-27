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
 *
 * T01-04：已补齐老引擎 `EasingType` **全集 16 个**（Linear + Quad×3 + Cubic×3 + Back×3 +
 * Elastic×3 + Bounce×3）——此前只有 7 个，作者写 `EaseOutBounce` 会被静默回退成默认缓动。
 * **回退语义沿用老引擎**（`Enum.TryParse` 失败 → `EaseOutQuad`），故不改为抛错（避免对既有故事
 * 制造新错误）；「未知缓动名」的编辑期提示列为可选后续（见 tasks 01 模块 T01-04 备注）。
 */
const EASINGS: Record<string, (t: number) => number> = {
  // 命名照老引擎 `EasingType`（**首字母大写**：`Linear`），因此这里大小写不敏感查找
  Linear: (t) => t,
  EaseInQuad: (t) => t * t,
  EaseOutQuad: (t) => t * (2 - t),
  EaseInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  EaseInCubic: (t) => t * t * t,
  EaseOutCubic: (t) => 1 - (1 - t) ** 3,
  EaseInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  // —— T01-04：补齐老引擎 `EasingType` 全集（Back / Elastic / Bounce，逐条移植公式）——
  // 命名与公式来源：老引擎 `EngineCore/LingFanEngine.Abstractions/.../EasingType.cs`
  //                + `Services/Core/AnimationService.cs` 的 `ApplyEasing`
  EaseInBack: (t) => t * t * (2.70158 * t - 1.70158),
  EaseOutBack: (t) => (t - 1) * (t - 1) * (2.70158 * (t - 1) + 1.70158) + 1,
  EaseInOutBack: (t) =>
    t < 0.5
      ? 0.5 * (t * 2) * (t * 2) * (2.70158 * (t * 2) - 1.70158)
      : 0.5 *
        ((t * 2 - 2) * (t * 2 - 2) * (2.70158 * (t * 2 - 2) + 1.70158) + 2),
  EaseInElastic: (t) =>
    t === 0 || t === 1
      ? t
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * 2.094395102),
  EaseOutElastic: (t) =>
    t === 0 || t === 1
      ? t
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * 2.094395102) + 1,
  EaseInOutElastic: (t) =>
    t === 0 || t === 1
      ? t
      : t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * 1.396263402)) /
          2
        : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * 1.396263402)) /
            2 +
          1,
  EaseOutBounce: (t) => easeOutBounce(t),
  EaseInBounce: (t) => 1 - easeOutBounce(1 - t),
  EaseInOutBounce: (t) =>
    t < 0.5
      ? (1 - easeOutBounce(1 - 2 * t)) / 2
      : (1 + easeOutBounce(2 * t - 1)) / 2,
};

/** Bounce 基函数（老引擎 `AnimationService.EaseOutBounce` 同款分段） */
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const t2 = t - 1.5 / d1;
    return n1 * t2 * t2 + 0.75;
  }
  if (t < 2.5 / d1) {
    const t3 = t - 2.25 / d1;
    return n1 * t3 * t3 + 0.9375;
  }
  const t4 = t - 2.625 / d1;
  return n1 * t4 * t4 + 0.984375;
}

const DEFAULT_EASING = "EaseOutQuad";

/**
 * 大小写不敏感查找表：老引擎 `EasingType` 用 `Linear`（首字母大写），
 * 而新引擎既有语料/测试写 `linear` —— 两者都解析到同一函数（**更宽松 = 不破坏既有故事**）。
 */
const EASING_LOOKUP: ReadonlyMap<string, (t: number) => number> = new Map(
  Object.entries(EASINGS).map(([name, fn]) => [name.toLowerCase(), fn]),
);

export function easingFn(name: string): (t: number) => number {
  return (
    EASING_LOOKUP.get(name.toLowerCase()) ??
    EASINGS[DEFAULT_EASING]!
  );
}

/** 已知缓动名（编辑器表单/诊断可枚举；不含回退项）——恒为老引擎 `EasingType` 全集 16 个 */
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
