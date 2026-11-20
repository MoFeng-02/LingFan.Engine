/**
 * skip/auto 宿主节奏循环旅程：按住快进按拍推进、自动播放延时推进、守卫命中即停、
 * 偏好逐拍现读、收尾一次退掉两个循环（未启动的模式不触碰引擎）。
 *
 * 用假定时器 + 最小引擎/打字机替身（不引 jsdom）：节奏是宿主装配，引擎只认模式旗标与
 * guarded 推进，故这里验证「按什么节奏调引擎」而非引擎语义本身。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerPreferences, StoryEngine } from "@lingfan-engine/core";
import { createAutomatedAdvanceLoop } from "@lingfan-engine/ui";

function harness() {
  const skipCalls: boolean[] = [];
  const autoCalls: boolean[] = [];
  const automated: Array<{ skipUnseenOnly?: boolean } | undefined> = [];
  const state = {
    waiting: "dialog" as string,
    skipActive: false,
    advanceResult: true,
    typewriterDone: true,
  };
  const click = vi.fn();
  const engine = {
    skip: (on: boolean) => skipCalls.push(on),
    auto: (on: boolean) => autoCalls.push(on),
    skipActive: () => state.skipActive,
    get: () => state.waiting,
    advanceAutomated: (options?: { skipUnseenOnly?: boolean }) => {
      automated.push(options);
      return state.advanceResult;
    },
  };
  const prefs = {
    skipDelayMs: 50,
    autoDelayMs: 1500,
    skipUnseenOnly: false,
    autoEnabled: true,
  };
  const loop = createAutomatedAdvanceLoop({
    getEngine: () => engine as unknown as StoryEngine,
    readTypewriter: () => ({ done: state.typewriterDone, click }),
    preferences: prefs as unknown as PlayerPreferences,
  });
  return { loop, skipCalls, autoCalls, automated, state, click, prefs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("快进（按住持续）", () => {
  it("起循环置 skip 模式，按 skipDelayMs 节奏调 guarded 推进", () => {
    const h = harness();
    h.loop.startSkip();
    expect(h.skipCalls).toEqual([true]);
    expect(h.automated).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(h.automated).toHaveLength(1);
    expect(h.automated[0]).toEqual({ skipUnseenOnly: false });
    vi.advanceTimersByTime(100);
    expect(h.automated).toHaveLength(3);
  });

  it("打字机未打完先补完再推进", () => {
    const h = harness();
    h.state.typewriterDone = false;
    h.loop.startSkip();
    vi.advanceTimersByTime(50);
    expect(h.click).toHaveBeenCalledTimes(1);
    expect(h.automated).toHaveLength(1);
  });

  it("守卫命中（推进返回 false）即停模式", () => {
    const h = harness();
    h.state.advanceResult = false;
    h.loop.startSkip();
    vi.advanceTimersByTime(50);
    expect(h.skipCalls).toEqual([true, false]);
    vi.advanceTimersByTime(200);
    expect(h.automated).toHaveLength(1);
  });

  it("skipUnseenOnly 逐拍现读偏好", () => {
    const h = harness();
    h.prefs.skipUnseenOnly = true;
    h.loop.startSkip();
    vi.advanceTimersByTime(50);
    expect(h.automated[0]).toEqual({ skipUnseenOnly: true });
  });
});

describe("自动（偏好开关 + 延时）", () => {
  it("起循环置 auto 模式，打字机打完且够 autoDelayMs 才推进", () => {
    const h = harness();
    h.loop.startAuto();
    expect(h.autoCalls).toEqual([true]);
    vi.advanceTimersByTime(1000);
    expect(h.automated).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(h.automated.length).toBeGreaterThanOrEqual(1);
  });

  it("打字机未打完不推进", () => {
    const h = harness();
    h.state.typewriterDone = false;
    h.loop.startAuto();
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
  });

  it("快进时让位（skipActive 不自动推进）", () => {
    const h = harness();
    h.state.skipActive = true;
    h.loop.startAuto();
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
  });

  it("非对话等待态不自动推进", () => {
    const h = harness();
    h.state.waiting = "menu";
    h.loop.startAuto();
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
  });

  it("偏好关闭即停模式", () => {
    const h = harness();
    h.loop.startAuto();
    h.prefs.autoEnabled = false;
    vi.advanceTimersByTime(100);
    expect(h.autoCalls).toEqual([true, false]);
  });
});

describe("收尾", () => {
  it("未启动的模式 dispose 不触碰引擎", () => {
    const h = harness();
    h.loop.dispose();
    expect(h.skipCalls).toEqual([]);
    expect(h.autoCalls).toEqual([]);
  });

  it("已启动的两个循环一次 dispose 全停", () => {
    const h = harness();
    h.loop.startSkip();
    h.loop.startAuto();
    h.loop.dispose();
    expect(h.skipCalls).toEqual([true, false]);
    expect(h.autoCalls).toEqual([true, false]);
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
  });
});
