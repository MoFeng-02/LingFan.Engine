/**
 * 帧驱动表现：把引擎里的**动画描述**逐帧插值成 DOM 写入。
 *
 * 引擎只写描述（离散、进快照），逐帧的插值与 DOM 写入发生在宿主侧——本模块就是那一步的
 * 唯一实现。插值数学一律取自展示域既有纯函数（`interpolateAnimation` / `transitionOpacity` /
 * `shakeOffset`），此处不新增第二份算式。
 *
 * 三段共用一个 `dt`，顺序固定：元素动画 → 全屏转场 → 屏幕震动。
 *
 * 本模块**不认识引擎实例**：它用到的那几件事（当前动画队列、转场与震动描述、三个播毕交回）
 * 全部以 `EffectSource` 端口注入。于是每处引擎调用都变成宿主那侧的一行接线，而时机判定、
 * 累计量与收尾顺序只留在这一处。
 *
 * DOM 写入同样经注入：
 * - `readAnimationHost()` 返回动画节点所在的容器（无容器时元素动画仍要交回引擎，故不能提前 return）；
 * - `onAnimatedProperty(node, property, value)` 把数值属性写进该节点；
 * - `onTransitionFrame(opacity)` / `onTransitionDone()` 与 `onShakeFrame(x, y)` / `onShakeDone()`
 *   成对出现：宿主在 `*Frame` 里写遮罩与位移，在 `*Done` 里收尾（隐藏遮罩、位移归位）。
 *
 * 元素动画**必须交回引擎**（`source.animationFinished`）：否则动画队列只增不减（长会话泄漏），
 * 且元素永远到不了终值。
 *
 * 「节点在不在」由宿主在 `on*` 里自行兜底（如遮罩元素缺失时直接丢弃该帧）：本模块不做
 * 存在性判断，否则同一份时机判定会被各宿主的 DOM 结构差异撕成多份。
 *
 * 逐帧读 `animations()` 而非构造期取一次：动画由故事命令在任意时刻建立。
 */

import { interpolateAnimation, shakeOffset, transitionOpacity } from "../element";
import type { AnimationSpec } from "@lingfan/engine";

/**
 * 元素动画的可写样式声明：只有故事语言里出现的那五个数值属性。
 * 用对象而不是直接写 `node.style`，是为了让「属性 → CSS」这层映射留在本模块，
 * 而把唯一的写动作留在宿主（`Object.assign(node.style, …)`）。
 */
export interface AnimatedStyle {
  left?: string;
  top?: string;
  opacity?: string;
  transform?: string;
}

/**
 * 数值属性 → CSS 声明。
 *
 * `x`/`y` 走 `left`/`top`（相对定位位移），`rotation`/`scale` 都落在 `transform` 上——
 * 同一时刻只有一个 transform 生效，这是元素样式既有的口径（作者若要叠加请自己写 `style`）。
 * 未识别的属性返回 null：宿主据此跳过写入，而不是写一个空声明把已有样式抹掉。
 */
export function resolveAnimatedStyle(
  property: string,
  value: number,
): AnimatedStyle | null {
  if (property === "x") return { left: `${value}px` };
  if (property === "y") return { top: `${value}px` };
  if (property === "opacity") return { opacity: String(value) };
  if (property === "rotation") return { transform: `rotate(${value}deg)` };
  if (property === "scale") return { transform: `scale(${value})` };
  return null;
}

/** 引擎侧事实与交回动作：三个播毕交回是动画队列得以继续推进的唯一出口 */
export interface EffectSource {
  /** 当前待播的元素动画队列 */
  animations(): readonly AnimationSpec[];
  /** 全屏转场的启动键（未在转场时为 undefined） */
  transition(): { duration: number } | undefined;
  /** 屏幕震动的启动键（未在震动时为 undefined） */
  shake(): { intensity: number; duration: number } | undefined;
  /** 元素动画播毕：交回引擎，元素才会落到终值 */
  animationFinished(seq: number): void;
  /** 全屏转场播毕：交回引擎，转场命令才会继续 */
  transitionFinished(): void;
  /** 屏幕震动播毕：交回引擎，震动命令才会继续 */
  shakeFinished(): void;
}

/**
 * 宿主触点（注入端口）：本模块只做插值与时机判定，DOM 读写全由宿主实现。
 * `node` 是不透明句柄——本模块不查节点、不读样式、不写样式。
 */
export interface AnimationHost {
  /** 动画节点所在容器；返回 null 时元素动画只交回引擎、不写 DOM */
  readAnimationHost(): HTMLElement | null;
  /** 数值属性 → CSS 写入（映射口径与元素样式一致） */
  onAnimatedProperty(node: HTMLElement, property: string, value: number): void;
}

/** 全屏转场与屏幕震动的宿主触点（每帧回调先于播毕回调） */
export interface EffectSurfaceHost {
  /** 转场遮罩的一帧：写入不透明度（显示时机由宿主决定） */
  onTransitionFrame(opacity: number): void;
  /** 转场播毕：宿主收尾（隐藏遮罩） */
  onTransitionDone(): void;
  /** 屏幕震动的一帧：对舞台根施加偏移 */
  onShakeFrame(x: number, y: number): void;
  /** 震动播毕：宿主归位 */
  onShakeDone(): void;
}

/** 逐帧驱动函数的输入：三段各自的事实来源与 DOM 触点 */
export interface VisualEffectsOptions {
  /** 引擎侧事实与播毕交回 */
  source: EffectSource;
  animation: AnimationHost;
  surface: EffectSurfaceHost;
}

/**
 * 创建一个逐帧驱动函数：宿主每帧调用一次，传入距上一帧的秒数。
 *
 * 累计量（各动画已播秒数、转场已播秒数、震动时钟）都在闭包里，每实例一份——
 * 放在模块级会让同一页面的两个舞台互相串扰。
 */
export function createVisualEffects(
  options: VisualEffectsOptions,
): (dt: number) => void {
  const { source, animation, surface } = options;
  /** seq → 已播秒数 */
  const animatedElapsed = new Map<number, number>();
  let transitionElapsed = 0;
  let shakeClock = 0;

  return (dt: number): void => {
    // ① 元素动画：累计 elapsed → 插值写 DOM → 播毕交回引擎（终值写回元素属性）
    const animations = source.animations();
    if (animations.length > 0) {
      const hostEl = animation.readAnimationHost();
      for (const spec of animations) {
        const elapsed = (animatedElapsed.get(spec.seq) ?? 0) + dt;
        animatedElapsed.set(spec.seq, elapsed);
        const { value, done } = interpolateAnimation(spec, elapsed);
        const node = hostEl?.querySelector<HTMLElement>(
          `[data-lf-id="${spec.target}"]`,
        );
        if (node != null) {
          animation.onAnimatedProperty(node, spec.property, value);
        }
        if (done) {
          animatedElapsed.delete(spec.seq);
          source.animationFinished(spec.seq);
        }
      }
    }

    // ② 全屏转场：读启动键按进度改遮罩，播毕清除
    const transition = source.transition();
    if (transition != null) {
      transitionElapsed += dt;
      const progress =
        transition.duration > 0 ? transitionElapsed / transition.duration : 1;
      surface.onTransitionFrame(transitionOpacity(progress));
      if (progress >= 1) {
        transitionElapsed = 0;
        surface.onTransitionDone();
        source.transitionFinished();
      }
    }

    // ③ 屏幕震动：对舞台根施加衰减偏移，播毕归位
    const shake = source.shake();
    if (shake != null) {
      shakeClock += dt;
      const progress = shake.duration > 0 ? shakeClock / shake.duration : 1;
      const { x, y } = shakeOffset(shake.intensity, progress, shakeClock);
      surface.onShakeFrame(x, y);
      if (progress >= 1) {
        shakeClock = 0;
        surface.onShakeDone();
        source.shakeFinished();
      }
    }
  };
}
