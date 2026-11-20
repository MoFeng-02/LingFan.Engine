/**
 * 系统「减弱动效」测量与订阅测试（createReducedMotionQuery）。
 *
 * 核心不变量：matches 每次现读媒体查询当下值；订阅在系统设置变化时通知；dispose 拆监听
 * 后不再通知。兼容性双路径：现代 MediaQueryList.addEventListener（Safari 14+）与旧式
 * addListener（Safari 13.1 基线）都要走通——特征探测按 addEventListener 是否存在分流。
 * 五类覆盖：多方位（双路径）、拟态旅程（系统设置中途变化即时通知）、故意错误（dispose 后
 * 不再通知）、不变量（matches 恒等于媒体当下值）、边界（多订阅/退订单个）。
 */
import { describe, expect, it, vi } from "vitest";
import { createReducedMotionQuery } from "@lingfan-engine/ui";

/** 现代 MediaQueryList 替身：有 addEventListener/removeEventListener。 */
function modernMedia(initial: boolean) {
  const listeners = new Set<(ev: unknown) => void>();
  const media = {
    matches: initial,
    addEventListener: vi.fn((_type: string, fn: (ev: unknown) => void) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_type: string, fn: (ev: unknown) => void) => {
      listeners.delete(fn);
    }),
    fire(next: boolean): void {
      media.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
  return media;
}

/** 旧 WebView 替身：只有 addListener/removeListener（无 addEventListener）。 */
function legacyMedia(initial: boolean) {
  const listeners = new Set<(ev: unknown) => void>();
  const media = {
    matches: initial,
    addListener: vi.fn((fn: (ev: unknown) => void) => {
      listeners.add(fn);
    }),
    removeListener: vi.fn((fn: (ev: unknown) => void) => {
      listeners.delete(fn);
    }),
    fire(next: boolean): void {
      media.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
  return media;
}

describe("现代路径：addEventListener（Safari 14+）", () => {
  it("matches 现读媒体当下值，系统变化即时反映", () => {
    const media = modernMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    expect(query.matches()).toBe(false);
    media.fire(true);
    expect(query.matches()).toBe(true);
    query.dispose();
  });

  it("订阅在系统设置变化时通知；用 change 事件注册", () => {
    const media = modernMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    const seen: boolean[] = [];
    query.onChange(() => seen.push(query.matches()));
    expect(media.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    media.fire(true);
    media.fire(false);
    expect(seen).toEqual([true, false]);
    query.dispose();
  });

  it("dispose 拆除监听后不再通知（removeEventListener）", () => {
    const media = modernMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    const fn = vi.fn();
    query.onChange(fn);
    query.dispose();
    expect(media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    media.fire(true);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("旧 WebView 路径：addListener（Safari 13.1，无 addEventListener）", () => {
  it("特征探测分流到 addListener，订阅照常通知", () => {
    const media = legacyMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    expect(media.addListener).toHaveBeenCalledWith(expect.any(Function));
    const seen: boolean[] = [];
    query.onChange(() => seen.push(query.matches()));
    media.fire(true);
    expect(seen).toEqual([true]);
    expect(query.matches()).toBe(true);
    query.dispose();
  });

  it("dispose 走 removeListener，拆除后不再通知", () => {
    const media = legacyMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    const fn = vi.fn();
    query.onChange(fn);
    query.dispose();
    expect(media.removeListener).toHaveBeenCalledWith(expect.any(Function));
    media.fire(true);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("订阅边界：多订阅与退订单个", () => {
  it("多个订阅都收到通知；退订其一不影响其余", () => {
    const media = modernMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    const a = vi.fn();
    const b = vi.fn();
    const offA = query.onChange(a);
    query.onChange(b);
    media.fire(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    media.fire(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    query.dispose();
  });

  it("dispose 清空全部订阅（即便未逐一退订）", () => {
    const media = modernMedia(false);
    const query = createReducedMotionQuery(media as unknown as MediaQueryList);
    const a = vi.fn();
    const b = vi.fn();
    query.onChange(a);
    query.onChange(b);
    query.dispose();
    media.fire(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
