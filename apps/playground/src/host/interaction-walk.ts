/**
 * 演示玩法系统「极简 WASD 行走」。
 *
 * 与演示小游戏同口径：宿主装配期注册进玩法系统表，未注册的 `system` 在
 * 事件分支里 fail-closed，等待保持。本演示刻意保持最小——只演示
 * 「接管挂载点 → 每帧写状态 → 回填结果」三段，真实玩法系统（寻路、碰撞、
 * 战斗）由产品自行实现，引擎只提供接缝。
 *
 * 挂载点上的演示类标记由组合根注入：类名字面串留在组合根，样式表与源级
 * 互锁都按那里的写法读。中止（回溯/导航/读档/销毁）走 cleanup；正常抵达
 * 与异常由组合根的收口统一清理，两条结束路径只写一处。
 */

import type {
  GameStateWriter,
  InteractionContext,
  InteractionResult,
} from "@lingfan/engine";
import { abortSignalOf } from "./abort-signal";

/** 故事未在 `config.target` 里给终点时的演示默认值（像素） */
export const DEFAULT_WALK_TARGET_PX = 120;

/** 演示行走速度（像素/秒）；真实系统自定 */
export const DEFAULT_WALK_SPEED_PX_PER_SEC = 40;

/** 玩法系统工厂的宿主侧上下文：在引擎契约之外，宿主额外注入状态写入器 */
export type WalkContext = InteractionContext & { writer: GameStateWriter };

/** 玩法系统工厂：接管挂载点后返回本次玩法的结果 */
export type WalkFactory = (
  host: HTMLElement,
  ctx: WalkContext,
) => Promise<InteractionResult>;

/** 装配 walk 工厂所需的宿主侧依赖 */
export interface InteractionWalkOptions {
  /** 未配置 target 时的终点；缺省用 {@link DEFAULT_WALK_TARGET_PX} */
  defaultTargetPx?: number;
  /** 移动速度；缺省用 {@link DEFAULT_WALK_SPEED_PX_PER_SEC} */
  speedPxPerSec?: number;
  /** 在挂载点上打演示类标记（`classList.add` 的写法由组合根持有） */
  markHost(host: HTMLElement): void;
}

/**
 * 造 walk 工厂：宿主装配期注册进玩法系统表。
 *
 * 每帧把当前位置静默写入作用域状态（高频，不进事件流），抵达时用事件流
 * 通道写一次终值并回填 `{ outcome: "success", state: { arrived: true } }`。
 * 方向键由玩法系统独占，按下时阻止默认行为，避免同时触发宿主回溯。
 */
export function createInteractionWalk(
  options: InteractionWalkOptions,
): WalkFactory {
  const defaultTargetPx = options.defaultTargetPx ?? DEFAULT_WALK_TARGET_PX;
  const speedPxPerSec =
    options.speedPxPerSec ?? DEFAULT_WALK_SPEED_PX_PER_SEC;
  return (host, ctx) => {
    const target =
      typeof ctx.config.target === "number"
        ? ctx.config.target
        : defaultTargetPx;
    return new Promise((resolve) => {
      host.innerHTML = "";
      options.markHost(host);
      const avatar = document.createElement("div");
      avatar.className = "walk-avatar";
      const hint = document.createElement("p");
      hint.className = "walk-hint";
      host.append(hint, avatar);

      let x = 0;
      let pressed: string | null = null;
      const render = (): void => {
        avatar.style.transform = `translateX(${x}px)`;
        hint.textContent = `WASD/A-D 移动 → 走到 ${target}px 结束（当前 ${Math.round(x)}）`;
        ctx.writer.setScopedSilent("walk", "x", Math.round(x));
      };
      const onKey = (e: KeyboardEvent): void => {
        const k = e.key.toLowerCase();
        if (k === "a" || k === "arrowleft") pressed = "left";
        else if (k === "d" || k === "arrowright") pressed = "right";
        else return;
        e.preventDefault();
      };
      const onKeyUp = (): void => {
        pressed = null;
      };
      let raf = 0;
      let last = performance.now();
      const tick = (now: number): void => {
        const dt = (now - last) / 1000;
        last = now;
        if (pressed === "left") x = Math.max(0, x - speedPxPerSec * dt);
        if (pressed === "right") x = Math.min(target, x + speedPxPerSec * dt);
        render();
        if (x >= target) {
          ctx.writer.setScoped("walk", "x", target);
          resolve({ outcome: "success", state: { arrived: true } });
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      const cleanup = (): void => {
        cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKeyUp);
        host.innerHTML = "";
      };
      abortSignalOf(ctx.signal).addEventListener("abort", cleanup, {
        once: true,
      });
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKeyUp);
      render();
      raf = requestAnimationFrame(tick);
    });
  };
}
