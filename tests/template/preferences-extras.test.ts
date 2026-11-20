/**
 * 模板偏好面板扩展控件组（主音量 + 文本/显示偏好 + 缓办禁用占位）。
 *
 * 锁三条纪律：
 * - **只渲染本批接了消费的字段**：每个活控件写回 `PlayerPreferences` 即时生效；
 * - **缓办字段禁用占位**：打字音效/窗口尺寸/字体/自动播放/快进画出来但 disabled，
 *   不留「活控件死配置」；
 * - **三态下拉**：值 "" = 跟随默认 → clear 回未设置（不写默认键进快照）。
 *
 * DOM 替身手法与 preferences-panel.test.ts 同口径（vi.stubGlobal document，不引 jsdom）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerPreferences } from "@lingfan-engine/core";
import { createPreferencesPanel } from "../../template/v1/__PROJECT__/src/host/panels/preferences.ts";

interface FakeEvent {
  target: unknown;
  stopPropagation(): void;
}
type FakeListener = (event: FakeEvent) => void;

interface FakeNode {
  tagName: string;
  className: string;
  dataset: Record<string, string>;
  children: FakeNode[];
  textContent: string;
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  title: string;
  min: string;
  max: string;
  step: string;
  appendChild(child: FakeNode): FakeNode;
  addEventListener(type: string, handler: FakeListener): void;
  fire(type: string): void;
}

function createFakeNode(tag: string): FakeNode {
  const listeners = new Map<string, FakeListener[]>();
  const node = {
    tagName: tag.toUpperCase(),
    className: "",
    dataset: {} as Record<string, string>,
    children: [] as FakeNode[],
    type: "",
    value: "",
    checked: false,
    disabled: false,
    title: "",
    min: "",
    max: "",
    step: "",
    appendChild(child: FakeNode): FakeNode {
      node.children.push(child);
      return child;
    },
    addEventListener(type: string, handler: FakeListener): void {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire(type: string): void {
      const event: FakeEvent = { target: node, stopPropagation(): void {} };
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
  } as unknown as FakeNode;
  let text = "";
  Object.defineProperty(node, "textContent", {
    enumerable: true,
    configurable: true,
    get: () => text,
    set: (next: string) => {
      text = next;
      if (next === "") node.children.length = 0;
    },
  });
  return node;
}

function walk(node: FakeNode, visit: (node: FakeNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/** 按 data-setting 取控件（INPUT 或 SELECT） */
function control(container: FakeNode, setting: string): FakeNode {
  const hits: FakeNode[] = [];
  walk(container, (node) => {
    if (node.dataset.setting === setting) hits.push(node);
  });
  const first = hits[0];
  if (first === undefined) throw new Error(`未找到控件：${setting}`);
  return first;
}

function setup() {
  const prefs = new PlayerPreferences();
  const container = createFakeNode("div");
  const panel = createPreferencesPanel({
    preferences: prefs,
    container: container as unknown as HTMLElement,
  });
  panel.mount();
  return { prefs, container, panel };
}

/** 滑杆写值并派发 input */
function slide(container: FakeNode, setting: string, value: string): void {
  const input = control(container, setting);
  input.value = value;
  input.fire("input");
}

/** 下拉选值并派发 change */
function pick(container: FakeNode, setting: string, value: string): void {
  const select = control(container, setting);
  select.value = value;
  select.fire("change");
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFakeNode(tag),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("活控件写回偏好（即时生效）", () => {
  it("主音量滑杆 → setMasterVolume", () => {
    const h = setup();
    slide(h.container, "master-volume", "0.5");
    expect(h.prefs.masterVolume).toBe(0.5);
  });

  it("主音量在静音时禁用（与通道一致）", () => {
    const h = setup();
    expect(control(h.container, "master-volume").disabled).toBe(false);
    h.prefs.setMuted(true);
    expect(control(h.container, "master-volume").disabled).toBe(true);
  });

  it("即时显示开关 → setInstantText", () => {
    const h = setup();
    const input = control(h.container, "instant-text");
    input.checked = true;
    input.fire("change");
    expect(h.prefs.instantText).toBe(true);
  });

  it("NVL 每页行数 / 转场倍率 / 抖动 / 字号 / 框透明度 / 框高倍率滑杆各自写回", () => {
    const h = setup();
    slide(h.container, "nvl-page-size", "5");
    slide(h.container, "transition-speed", "2");
    slide(h.container, "shake-scale", "0.5");
    slide(h.container, "font-scale", "1.5");
    slide(h.container, "dialogue-opacity", "0.4");
    slide(h.container, "dialogue-height-scale", "1.2");
    expect(h.prefs.nvlPageSize).toBe(5);
    expect(h.prefs.transitionSpeed).toBe(2);
    expect(h.prefs.shakeScale).toBe(0.5);
    expect(h.prefs.fontScale).toBe(1.5);
    expect(h.prefs.dialogueOpacity).toBe(0.4);
    expect(h.prefs.dialogueHeightScale).toBe(1.2);
  });

  it("滑杆空串 = 无效写入，偏好原样（fail-closed，不误调静音）", () => {
    const h = setup();
    const before = h.prefs.masterVolume;
    slide(h.container, "master-volume", "");
    expect(h.prefs.masterVolume).toBe(before);
  });
});

describe("三态下拉：空值 = 跟随默认 → clear 回未设置", () => {
  it("减弱动效 on/off/跟随系统", () => {
    const h = setup();
    pick(h.container, "reduced-motion", "on");
    expect(h.prefs.reducedMotion).toBe(true);
    pick(h.container, "reduced-motion", "off");
    expect(h.prefs.reducedMotion).toBe(false);
    pick(h.container, "reduced-motion", "");
    expect(h.prefs.reducedMotion).toBeUndefined();
  });

  it("对话框位置 top/默认", () => {
    const h = setup();
    pick(h.container, "dialogue-position", "top");
    expect(h.prefs.dialoguePosition).toBe("top");
    pick(h.container, "dialogue-position", "");
    expect(h.prefs.dialoguePosition).toBeUndefined();
  });

  it("元素填充默认 contain/默认", () => {
    const h = setup();
    pick(h.container, "element-fit", "contain");
    expect(h.prefs.elementFit).toBe("contain");
    pick(h.container, "element-fit", "");
    expect(h.prefs.elementFit).toBeUndefined();
  });
});

describe("缓办字段禁用占位（不留活控件死配置）", () => {
  it("打字音效/窗口尺寸/字体/自动播放/快进均 disabled", () => {
    const h = setup();
    for (const setting of [
      "type-sound",
      "window-size",
      "font-family",
      "auto-play",
      "skip",
    ]) {
      expect(control(h.container, setting).disabled).toBe(true);
    }
  });
});

describe("偏好外部改动 → 控件回填（onChange live）", () => {
  it("挂载后外部改字号，滑杆值随动", () => {
    const h = setup();
    expect(control(h.container, "font-scale").value).toBe("1");
    h.prefs.setFontScale(2);
    expect(control(h.container, "font-scale").value).toBe("2");
  });

  it("外部 clear 三态字段，下拉回到空值（跟随默认）", () => {
    const h = setup();
    h.prefs.setElementFit("contain");
    expect(control(h.container, "element-fit").value).toBe("contain");
    h.prefs.clearElementFit();
    expect(control(h.container, "element-fit").value).toBe("");
  });
});
