/**
 * 帧驱动表现：把引擎里的动画描述逐帧写成 DOM。
 *
 * 机制（累计、插值、播毕时机）在展示层（`createVisualEffects`），本文件只做两件本宿主
 * 独有的事：把引擎与本宿主的 DOM 接上，以及把数值属性落成 CSS 声明。
 *
 * 元素动画**必须交回引擎**（`animationFinished`）：否则动画队列只增不减（长会话泄漏），
 * 元素也永远到不了终值——终值是引擎在播毕后写回元素属性的。
 */

import { SYS, type StoryEngine } from "@lingfan/engine";
import { createVisualEffects, resolveAnimatedStyle } from "@lingfan/ui";
import type { StageDom } from "./stage-dom";

/** 逐帧驱动函数的输入：节点句柄表与引擎（三个播毕交回都直连引擎） */
export interface HostEffectsOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 引擎：动画队列、转场与震动的启动键、三个播毕交回 */
  engine: StoryEngine;
}

/** 造本宿主的逐帧驱动函数：宿主每帧调用一次，传入距上一帧的秒数 */
export function createHostEffects(options: HostEffectsOptions): (dt: number) => void {
  const { dom, engine } = options;
  return createVisualEffects({
    source: {
      animations: () => engine.animations(),
      transition: () =>
        engine.get(SYS.transition) as { duration: number } | undefined,
      shake: () =>
        engine.get(SYS.shake) as
          | { intensity: number; duration: number }
          | undefined,
      animationFinished: (seq) => engine.animationFinished(seq),
      transitionFinished: () => engine.transitionFinished(),
      shakeFinished: () => engine.shakeFinished(),
    },
    animation: {
      // 动画节点在舞台层里按 data-lf-id 找（元素渲染器写入的定位锚）
      readAnimationHost: () => dom.stage,
      onAnimatedProperty: (node, property, value) => {
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
      onShakeFrame: (x, y) => {
        dom.root.style.transform = `translate(${x}px, ${y}px)`;
      },
      onShakeDone: () => {
        dom.root.style.transform = "";
      },
    },
  });
}
