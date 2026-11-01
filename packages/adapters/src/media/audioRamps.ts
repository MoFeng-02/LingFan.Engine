/**
 * 音频端口的斜坡调度：一条 `requestAnimationFrame` 跑完所有在跑的音量坡。
 *
 * 两种坡度并存：
 * - **具名坡**（`fade`）：按 key 覆盖，同 key 只留最新一条（四通道各持一条）；走完即出表，
 *   且目标为 0 时顺手 `pause` 元素——「淡出到静音就该停」的收尾就在这里，不另设停止点。
 * - **无名坡**（`ramp`）：每次独立一条，走完调 `onDone`（音效停止、实例淡出走同一条路）。
 *
 * 调度只该有一条 rAF：两条各自计时会让同一个元素的音量被两个坡互推。
 */
import { clamp, type Ramp } from "./audioRamp";

/** 斜坡调度面：起坡、撤坡、收尾。坡的形状与夹取规则见 `audioRamp` 模块 */
export interface AudioRampScheduler {
  /** 起/更新一条具名坡；`ms <= 0` 表示直接落值、不留坡 */
  fade(key: string, element: HTMLAudioElement, to: number, ms: number): void;
  /** 起一条无名坡，返回坡体（调用方若按自己的键记账，记的就是它） */
  ramp(
    element: HTMLAudioElement,
    to: number,
    ms: number,
    onDone: () => void,
  ): Ramp;
  /** 撤掉具名坡：音量停在当前值，不触发任何收尾 */
  cancel(key: string): void;
  /** 从无名坡里摘掉一条（调用方先行作废自己的记账时用） */
  drop(ramp: Ramp): void;
  /** 停掉在跑的 rAF 与全部坡（元素本身归调用方释放） */
  dispose(): void;
}

/** 造一套斜坡调度：具名坡与无名坡共用一条 rAF，坡空即自行停表 */
export function createAudioRampScheduler(): AudioRampScheduler {
  const named = new Map<string, Ramp>();
  /**
   * 无名坡。
   *
   * 具名坡按 key 存进 `named`；没有 key 的坡（音效停止、实例淡出）单列一个数组，
   * 与 `named` 共用同一条 rAF。
   */
  const unnamed: Ramp[] = [];
  let rafId = 0;

  function tick(now: number): void {
    rafId = 0;
    for (const [key, ramp] of [...named]) {
      const t = Math.min(1, (now - ramp.start) / ramp.ms);
      ramp.element.volume = clamp(ramp.from + (ramp.to - ramp.from) * t);
      if (t >= 1) {
        named.delete(key);
        if (ramp.to === 0) ramp.element.pause();
      }
    }
    for (let i = unnamed.length - 1; i >= 0; i -= 1) {
      const ramp = unnamed[i]!;
      const t = Math.min(1, (now - ramp.start) / ramp.ms);
      ramp.element.volume = clamp(ramp.from + (ramp.to - ramp.from) * t);
      if (t >= 1) {
        unnamed.splice(i, 1);
        // 走完要出表，否则调用方的记账会指向一个已经死掉的坡
        ramp.onDone?.();
      }
    }
    if (named.size > 0 || unnamed.length > 0) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function fade(
    key: string,
    element: HTMLAudioElement,
    to: number,
    ms: number,
  ): void {
    const target = clamp(to);
    if (ms <= 0) {
      named.delete(key);
      element.volume = target;
      return;
    }
    named.set(key, {
      element,
      from: element.volume,
      to: target,
      start: performance.now(),
      ms,
    });
    if (rafId === 0) rafId = requestAnimationFrame(tick);
  }

  function ramp(
    element: HTMLAudioElement,
    to: number,
    ms: number,
    onDone: () => void,
  ): Ramp {
    const ramp: Ramp = {
      element,
      from: element.volume,
      to: clamp(to),
      start: performance.now(),
      ms,
      onDone,
    };
    unnamed.push(ramp);
    if (rafId === 0) rafId = requestAnimationFrame(tick);
    return ramp;
  }

  function cancel(key: string): void {
    named.delete(key);
  }

  function drop(ramp: Ramp): void {
    const at = unnamed.indexOf(ramp);
    if (at >= 0) unnamed.splice(at, 1);
  }

  function dispose(): void {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    rafId = 0;
    named.clear();
    unnamed.length = 0;
  }

  return { fade, ramp, cancel, drop, dispose };
}
