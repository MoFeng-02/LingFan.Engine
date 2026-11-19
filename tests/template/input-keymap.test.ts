/**
 * 输入面的键位消费旅程：改绑读偏好、默认键位齐全、控件域优先、单一收尾。
 *
 * 用最小 DOM 替身（不引 jsdom）：document 与舞台节点的 addEventListener 都认 AbortSignal，
 * 于是「拆除函数一次 abort 退掉全部监听」这条纪律能被真的验证——退订后再按键不再推进。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerPreferences, SYS } from "@lingfan-engine/core";
import { wireInput } from "../../template/v1/__PROJECT__/src/host/input-map";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom";
import type { DialogueView } from "../../template/v1/__PROJECT__/src/host/dialogue-view";

type Handler = (event: Record<string, unknown>) => void;

class FakeElement {
  readonly listeners = new Map<string, Set<Handler>>();
  parent: FakeElement | null = null;

  addEventListener(
    type: string,
    handler: Handler,
    options?: { signal?: AbortSignal },
  ): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    options?.signal?.addEventListener("abort", () => set.delete(handler));
  }

  fire(type: string, event: Record<string, unknown> = {}): void {
    const enriched: Record<string, unknown> = {
      target: this,
      ...event,
      stopPropagation(): void {
        enriched._stopped = true;
      },
      preventDefault(): void {
        enriched._prevented = true;
      },
    };
    for (const handler of this.listeners.get(type) ?? []) handler(enriched);
    if (enriched._stopped !== true && this.parent !== null)
      this.parent.fire(type, enriched);
  }
}

const documentListeners = new Map<string, Set<Handler>>();

function stubDocument(): void {
  vi.stubGlobal("document", {
    addEventListener(
      type: string,
      handler: Handler,
      options?: { signal?: AbortSignal },
    ): void {
      let set = documentListeners.get(type);
      if (set === undefined) {
        set = new Set();
        documentListeners.set(type, set);
      }
      set.add(handler);
      options?.signal?.addEventListener("abort", () => set.delete(handler));
    },
  });
}

function press(event: Record<string, unknown>): void {
  for (const handler of documentListeners.get("keydown") ?? []) {
    handler({
      target: {},
      stopPropagation(): void {},
      preventDefault(): void {},
      ...event,
    });
  }
}

interface Harness {
  advance: ReturnType<typeof vi.fn>;
  back: ReturnType<typeof vi.fn>;
  forward: ReturnType<typeof vi.fn>;
  onHistory: ReturnType<typeof vi.fn>;
  onClosePanels: ReturnType<typeof vi.fn>;
  onQuickSave: ReturnType<typeof vi.fn>;
  onQuickLoad: ReturnType<typeof vi.fn>;
  viewport: FakeElement;
  disposeInput: () => void;
}

function harness(
  options: { waiting?: string; preferences?: PlayerPreferences } = {},
): Harness {
  stubDocument();
  const advance = vi.fn();
  const back = vi.fn();
  const forward = vi.fn();
  const onHistory = vi.fn();
  const onClosePanels = vi.fn();
  const onQuickSave = vi.fn();
  const onQuickLoad = vi.fn();
  const engine = {
    get: (key: string) =>
      key === SYS.waiting ? (options.waiting ?? "dialog") : undefined,
    advance,
    back,
    forward,
  };
  const dialogue = { readTypewriter: () => null } as unknown as DialogueView;
  const viewport = new FakeElement();
  const choices = new FakeElement();
  const toolbar = new FakeElement();
  const notifications = new FakeElement();
  choices.parent = viewport;
  toolbar.parent = viewport;
  notifications.parent = viewport;
  const dom = {
    viewport,
    choices,
    toolbar,
    notifications,
  } as unknown as StageDom;
  const disposeInput = wireInput({
    dom,
    engine: engine as never,
    dialogue,
    preferences: options.preferences,
    onHistory,
    onClosePanels,
    onQuickSave,
    onQuickLoad,
  });
  return {
    advance,
    back,
    forward,
    onHistory,
    onClosePanels,
    onQuickSave,
    onQuickLoad,
    viewport,
    disposeInput,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  documentListeners.clear();
});

describe("键位读偏好（改绑逐次现读）", () => {
  it("改绑后新键推进、旧默认键让位", () => {
    const preferences = new PlayerPreferences();
    preferences.setKeybinding("advance", ["a"]);
    const h = harness({ preferences });
    press({ key: "a" });
    expect(h.advance).toHaveBeenCalledTimes(1);
    press({ key: " " });
    expect(h.advance).toHaveBeenCalledTimes(1); // 空格已被改绑取代
  });

  it("大小写不敏感：绑 a 按 A 也推进", () => {
    const preferences = new PlayerPreferences();
    preferences.setKeybinding("advance", ["a"]);
    const h = harness({ preferences });
    press({ key: "A" });
    expect(h.advance).toHaveBeenCalledTimes(1);
  });

  it("逐项降级：清空推进改绑落回默认空格", () => {
    const preferences = new PlayerPreferences();
    preferences.setKeybinding("advance", ["a"]);
    preferences.clearKeybinding("advance");
    const h = harness({ preferences });
    press({ key: "a" });
    expect(h.advance).not.toHaveBeenCalled();
    press({ key: " " });
    expect(h.advance).toHaveBeenCalledTimes(1);
  });

  it("未接偏好层用内建默认键位", () => {
    const h = harness();
    press({ key: "Enter" });
    expect(h.advance).toHaveBeenCalledTimes(1);
  });
});

describe("默认键位齐全", () => {
  it("滚轮上滚回溯、下滚前进", () => {
    const h = harness();
    h.viewport.fire("wheel", { deltaY: -1 });
    expect(h.back).toHaveBeenCalledTimes(1);
    expect(h.forward).not.toHaveBeenCalled();
    h.viewport.fire("wheel", { deltaY: 1 });
    expect(h.forward).toHaveBeenCalledTimes(1);
  });

  it("h 开合历史、Esc 关面板", () => {
    const h = harness();
    press({ key: "h" });
    expect(h.onHistory).toHaveBeenCalledTimes(1);
    press({ key: "Escape" });
    expect(h.onClosePanels).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S 快速存档、Ctrl+L 快速读档", () => {
    const h = harness();
    press({ key: "s", ctrlKey: true });
    expect(h.onQuickSave).toHaveBeenCalledTimes(1);
    press({ key: "l", ctrlKey: true });
    expect(h.onQuickLoad).toHaveBeenCalledTimes(1);
    expect(h.advance).not.toHaveBeenCalled(); // 不被推进键吞掉
  });

  it("Cmd+S / Cmd+L 同样触发（metaKey）", () => {
    const h = harness();
    press({ key: "s", metaKey: true });
    expect(h.onQuickSave).toHaveBeenCalledTimes(1);
    press({ key: "l", metaKey: true });
    expect(h.onQuickLoad).toHaveBeenCalledTimes(1);
  });
});

describe("控件域优先（data-ui-zone 不穿透）", () => {
  it("目标在控件域内：按键与点击都不归叙事", () => {
    const h = harness();
    const zoneTarget = {
      closest: (selector: string) =>
        selector.includes("data-ui-zone") ? {} : null,
    };
    press({ key: " ", target: zoneTarget });
    expect(h.advance).not.toHaveBeenCalled();
    h.viewport.fire("click", { target: zoneTarget });
    expect(h.advance).not.toHaveBeenCalled();
  });

  it("菜单等待中推进键无效（用户实测回归）", () => {
    const h = harness({ waiting: "menu" });
    press({ key: " " });
    expect(h.advance).not.toHaveBeenCalled();
  });
});

describe("单一收尾（一次 abort 退掉全部监听）", () => {
  it("拆除后按键 / 点击 / 滚轮都不再触发", () => {
    const h = harness();
    h.disposeInput();
    press({ key: " " });
    h.viewport.fire("click");
    h.viewport.fire("wheel", { deltaY: -1 });
    expect(h.advance).not.toHaveBeenCalled();
    expect(h.back).not.toHaveBeenCalled();
  });
});
