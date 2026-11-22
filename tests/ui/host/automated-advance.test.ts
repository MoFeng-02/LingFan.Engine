/**
 * skip/auto 宿主节奏循环旅程：按住快进按拍推进、自动播放按句长停留后推进、守卫命中即停、
 * 偏好逐拍现读、收尾一次退掉两个循环（未启动的模式不触碰引擎）。
 *
 * 用假定时器 + 最小引擎/打字机替身（不引 jsdom）：节奏是宿主装配，引擎只认模式旗标与
 * guarded 推进，故这里验证「按什么节奏调引擎」而非引擎语义本身。
 *
 * 自动播放的停留时长不是定值：基础停留（`autoDelayMs`）+ 该句词元量 / 阅读速度
 * （`autoReadCps`）。这里用真实短句与长句各测一次，确认「长句停得久」确实来自句长而不是
 * 随机抖动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import { createAutomatedAdvanceLoop } from "@lingfan-engine/ui";

function harness() {
  const skipCalls: boolean[] = [];
  const autoCalls: boolean[] = [];
  const automated: Array<{ skipUnseenOnly?: boolean } | undefined> = [];
  const state = {
    waiting: "dialog" as string,
    /** 引擎里那条当前正文（自动播放按它数词元） */
    text: "嗯。" as string,
    skipActive: false,
    advanceResult: true,
    typewriterDone: true,
    /** 读面暴露的词元量；undefined = 宿主没接，退回按正文现数 */
    readingTokens: undefined as number | undefined,
  };
  const click = vi.fn();
  const engine = {
    skip: (on: boolean) => skipCalls.push(on),
    auto: (on: boolean) => autoCalls.push(on),
    skipActive: () => state.skipActive,
    get: (key?: string) =>
      key === SYS.currentDialogText ? state.text : state.waiting,
    advanceAutomated: (options?: { skipUnseenOnly?: boolean }) => {
      automated.push(options);
      return state.advanceResult;
    },
  };
  const prefs = {
    skipDelayMs: 50,
    autoDelayMs: 1500,
    autoReadCps: 12,
    skipUnseenOnly: false,
    autoEnabled: true,
  };
  const loop = createAutomatedAdvanceLoop({
    getEngine: () => engine as unknown as StoryEngine,
    readTypewriter: () => ({
      done: state.typewriterDone,
      click,
      readingTokens: state.readingTokens,
    }),
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

describe("自动（偏好开关 + 按句长停留）", () => {
  it("起循环置 auto 模式，打字机打完且停留够了才推进", () => {
    const h = harness();
    h.loop.startAuto();
    expect(h.autoCalls).toEqual([true]);
    // 「嗯。」1 个词元 / 12 cps ≈ 83ms，基础停留 1500ms；首拍在 100ms 起算
    vi.advanceTimersByTime(1500);
    expect(h.automated).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(h.automated.length).toBeGreaterThanOrEqual(1);
  });

  it("长句比短句停得久（停留按词元量分摊，不是所有句子一个定值）", () => {
    const short = harness();
    short.state.text = "嗯。";
    short.loop.startAuto();
    vi.advanceTimersByTime(1600);
    expect(short.automated).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(short.automated).toHaveLength(1);

    const long = harness();
    long.state.text = "夜风穿过长廊，灯影摇晃。光影里走出来一个人。";
    long.loop.startAuto();
    // 20 个词元 / 12 cps ≈ 1667ms，加上基础停留 1500ms 共约 3167ms
    vi.advanceTimersByTime(3100);
    expect(long.automated).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(long.automated).toHaveLength(1);
  });

  it("阅读速度越大停得越短", () => {
    const slow = harness();
    slow.state.text = "夜风穿过长廊，灯影摇晃。光影里走出来一个人。";
    slow.loop.startAuto();
    vi.advanceTimersByTime(3100);
    expect(slow.automated).toHaveLength(0);

    const fast = harness();
    fast.state.text = slow.state.text;
    fast.prefs.autoReadCps = 60;
    fast.loop.startAuto();
    // 20 个词元 / 60 cps ≈ 333ms，加基础停留 1500ms 共约 1833ms
    vi.advanceTimersByTime(1900);
    expect(fast.automated).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(fast.automated).toHaveLength(1);
  });

  it("读面给了词元量就按它算，缺省时退回按正文现数", () => {
    const reported = harness();
    reported.state.text = "嗯。";
    // 宿主上报 100 个词元：即使正文很短也要等足 1500 + 100/12*1000 ≈ 9833ms
    reported.state.readingTokens = 100;
    reported.loop.startAuto();
    vi.advanceTimersByTime(9800);
    expect(reported.automated).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(reported.automated).toHaveLength(1);

    const fallback = harness();
    fallback.state.text = "嗯。";
    fallback.state.readingTokens = undefined;
    fallback.loop.startAuto();
    vi.advanceTimersByTime(1600);
    expect(fallback.automated).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(fallback.automated).toHaveLength(1);
  });

  it("打字机未打完不推进", () => {
    const h = harness();
    h.state.typewriterDone = false;
    h.loop.startAuto();
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
  });

  it("停留计时以「这一句打完」为起点：打字慢不抵扣阅读时间", () => {
    const h = harness();
    h.state.text = "夜风穿过长廊，灯影摇晃。光影里走出来一个人。";
    h.state.typewriterDone = false;
    h.loop.startAuto();
    // 打字机打字的 3 秒不该被算进停留
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
    h.state.typewriterDone = true;
    vi.advanceTimersByTime(3000);
    expect(h.automated).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(h.automated).toHaveLength(1);
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
