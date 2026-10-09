/**
 * 演示小游戏工厂：点够指定次数即完成。
 *
 * 这是宿主侧的参考实现，不是引擎能力：小游戏注册表由组合根装配，
 * 未注册的 `gameId` 在事件分支里 fail-closed，不伪造完成。
 * 工厂只做三段——接管挂载点、建演示 UI、回填结果。
 *
 * 挂载点上的演示类标记由组合根注入：类名字面串留在组合根，
 * 样式表与源级互锁都按那里的写法读，工厂只负责在正确的时机调用它。
 */

import type { MinigameFactory } from "@lingfan/engine";
import { abortSignalOf } from "./abort-signal";

/** 故事未在 `config.target` 里给点击数时的演示默认值 */
export const DEFAULT_CLICK3_TARGET = 3;

/** 装配 click3 工厂所需的宿主侧依赖 */
export interface Click3DemoOptions {
  /** 未配置 target 时的点击数；缺省用 {@link DEFAULT_CLICK3_TARGET} */
  defaultTarget?: number;
  /** 在挂载点上打演示类标记（`classList.add` 的写法由组合根持有） */
  markHost(host: HTMLElement): void;
}

/**
 * 造 click3 工厂：宿主装配期注册进小游戏注册表。
 *
 * 计数与完成判定都在按钮监听里，完成时回填 `{ outcome: "success", score }`。
 * 中止信号只清空挂载点内容，演示类标记由事件分支的中止回调负责摘除。
 */
export function createClick3Demo(options: Click3DemoOptions): MinigameFactory {
  const defaultTarget = options.defaultTarget ?? DEFAULT_CLICK3_TARGET;
  return (container, ctx) => {
    const host = container as HTMLElement;
    return new Promise((resolve) => {
      const target = typeof ctx.config.target === "number" ? ctx.config.target : defaultTarget;
      host.innerHTML = "";
      options.markHost(host);
      const label = document.createElement("p");
      label.className = "minigame-label";
      label.textContent = `演示小游戏：点 ${target} 次完成`;
      const counter = document.createElement("div");
      counter.className = "minigame-count";
      counter.textContent = `0 / ${target}`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "点我";
      let clicks = 0;
      button.addEventListener("click", () => {
        clicks += 1;
        counter.textContent = `${clicks} / ${target}`;
        if (clicks >= target) resolve({ outcome: "success", score: clicks });
      });
      abortSignalOf(ctx.signal).addEventListener(
        "abort",
        () => {
          host.innerHTML = "";
        },
        { once: true },
      );
      host.append(label, counter, button);
    });
  };
}
