/**
 * 帧驱动表现：把引擎里的动画描述逐帧写成 DOM。
 *
 * 机制（累计、插值、播毕时机）在展示层（`createVisualEffects`），本文件只做两件本宿主
 * 独有的事：把引擎与本宿主的 DOM 接上，以及把数值属性落成 CSS 声明。
 *
 * 元素动画**必须交回引擎**（`animationFinished`）：否则动画队列只增不减（长会话泄漏），
 * 元素也永远到不了终值——终值是引擎在播毕后写回元素属性的。
 */

import {
  resolveReducedMotion,
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import { createVisualEffects, resolveAnimatedStyle } from "@lingfan-engine/ui";
import type { StageDom } from "./stage-dom";

/** 逐帧驱动函数的输入：节点句柄表与引擎（三个播毕交回都直连引擎） */
export interface HostEffectsOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 引擎：动画队列、转场与震动的启动键、三个播毕交回 */
  engine: StoryEngine;
  /** 玩家偏好（可选）：转场/动画时长倍率、震动强度倍率、减少动态，逐帧现读 */
  preferences?: PlayerPreferences;
  /**
   * 系统「减弱动效」读面（可选）：宿主测 `prefers-reduced-motion` 媒体查询注入。
   * 玩家未显式设置时跟随系统；逐帧现读，系统设置变化即时生效。
   */
  readSystemReducedMotion?: () => boolean;
}

/** 造本宿主的逐帧驱动函数：宿主每帧调用一次，传入距上一帧的秒数 */
export function createHostEffects(
  options: HostEffectsOptions,
): (dt: number) => void {
  const { dom, engine, preferences, readSystemReducedMotion } = options;
  return createVisualEffects({
    source: {
      animations: () => engine.animations(),
      transition: () =>
        engine.get(SYS.transition) as { duration: number } | undefined,
      shake: () =>
        engine.get(SYS.shake) as
          { intensity: number; duration: number } | undefined,
      animationFinished: (seq) => engine.animationFinished(seq),
      transitionFinished: () => engine.transitionFinished(),
      shakeFinished: () => engine.shakeFinished(),
    },
    // 玩家运动偏好：只乘算时长/强度、开关减少动态，不改引擎描述值（SSOT 仍是作者的）
    motion:
      preferences === undefined
        ? undefined
        : {
            transitionSpeed: () => preferences.transitionSpeed,
            shakeScale: () => preferences.shakeScale,
            // 三态合成：玩家显式 true/false 覆盖系统；玩家未设置（undefined）跟随系统
            // 媒体查询。不再把 undefined 塌缩成 false 跳过系统层（无障碍「跟随系统」语义）。
            reducedMotion: () =>
              resolveReducedMotion({
                player: preferences.reducedMotion,
                system: readSystemReducedMotion?.(),
              }),
          },
    animation: {
      // 动画节点在舞台层里按 data-lf-id 找（元素渲染器写入的定位锚）
      onAnimatedProperty: (target, property, value) => {
        const node = dom.stage.querySelector<HTMLElement>(
          `[data-lf-id="${target}"]`,
        );
        if (node === null) return;
        const style = resolveAnimatedStyle(property, value);
        // 未识别的属性跳过：写一个空声明会把元素已有样式抹掉
        if (style !== null) Object.assign(node.style, style);
      },
    },
    surface: {
      onTransitionFrame: (opacity) => {
        dom.transition.style.display = "block";
        dom.transition.style.opacity = String(opacity);
      },
      onTransitionDone: () => {
        dom.transition.style.display = "none";
      },
      // 震动只写震动层的位移分量：缩放留在父层（舞台根），两层各写各的不互相覆盖
      onShakeFrame: (x, y) => {
        dom.shake.style.transform = `translate(${x}px, ${y}px)`;
      },
      onShakeDone: () => {
        dom.shake.style.transform = "";
      },
    },
  });
}
