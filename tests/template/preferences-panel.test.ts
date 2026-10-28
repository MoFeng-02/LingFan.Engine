/**
 * 模板偏好面板（纯 DOM）：四通道音量 + 静音 + 文字速度。
 *
 * 断言分三层，刻意不混在一起：
 * - **视图层**（`view()`）：纯数据，且必须**每次现读偏好快照**——缓存一份副本的话，外部
 *   （元素回写 `cmd="volume:bgm"`、快捷键、别的面板）改完音量，面板视图会停在旧值。
 *   第 2 例专门锁这条：改偏好后视图立刻变，且两次快照是不同对象。
 * - **DOM 层**：挂载后控件回填当前偏好、偏好变化时被重新回填、卸载后容器清空。
 * - **生命周期层**：`mount()` 幂等（重复调用不叠控件、不重复订阅）、`destroy()` 真正退订
 *   （用计数版 `onChange` 观测订阅数 1 → 0 → 1），卸载后再改偏好不抛。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入，且本仓其他前端域测试也是这个手法（`tests/ui/element/slider-writeback.test.ts`
 * 的 `createFake`）。替身只实现本模块用到的面——`createElement` / `appendChild` /
 * `addEventListener` / `dataset` / `textContent`。
 *
 * `dataset.uiZone` 与 `data-ui-zone` 的对应：真实 DOM 里写 `dataset.uiZone` 就是写
 * `data-ui-zone` 属性（camelCase ↔ kebab-case，标准映射），替身按同一映射记录，
 * 故断言 `dataset.uiZone !== undefined` 即断言「节点带 data-ui-zone」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_PREFS, PlayerPreferences } from "@lingfan-engine/core";
import {
  createPreferencesPanel,
  PREF_CHANNELS,
  type PreferencesPanel,
  type PreferencesPanelView,
} from "../../template/v1/__PROJECT__/src/host/panels/preferences.ts";
import panelSource from "../../template/v1/__PROJECT__/src/host/panels/preferences.ts?raw";

// ---------- 最小 DOM 替身 ----------

interface FakeEvent {
  target: unknown;
  stopPropagation(): void;
}

type FakeListener = (event: FakeEvent) => void;

interface FakeNode {
  tagName: string;
  className: string;
  /** camelCase 键 ↔ `data-<kebab>` 属性（与真实 DOM 同一映射） */
  dataset: Record<string, string>;
  children: FakeNode[];
  textContent: string;
  /** 控件面（range / checkbox 共用一套字段，测试按需读写） */
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  min: string;
  max: string;
  step: string;
  appendChild(child: FakeNode): FakeNode;
  addEventListener(type: string, handler: FakeListener): void;
  fire(type: string): void;
  listenerCount(type: string): number;
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
    listenerCount(type: string): number {
      return (listeners.get(type) ?? []).length;
    },
    fire(type: string): void {
      const event: FakeEvent = { target: node, stopPropagation(): void {} };
      // 复制一份再遍历：处理器里若再注册/解绑不影响本次派发
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
  } as unknown as FakeNode;

  // 真实 DOM 的 textContent 写入是**整体替换子节点**：`container.textContent = ""` 即清空。
  // 本模块的 destroy() 依赖这条语义，替身必须照做，否则「已清空」的断言是假的。
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

/** 深度遍历（含根） */
function walk(node: FakeNode, visit: (node: FakeNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function findAll(
  root: FakeNode,
  predicate: (node: FakeNode) => boolean,
): FakeNode[] {
  const hits: FakeNode[] = [];
  walk(root, (node) => {
    if (predicate(node)) hits.push(node);
  });
  return hits;
}

/** 指定通道的音量滑杆（模块把通道标在 `data-channel` 上，不靠子节点下标） */
function volumeInput(container: FakeNode, channel: string): FakeNode {
  const hits = findAll(
    container,
    (node) => node.dataset.channel === channel && node.tagName === "INPUT",
  );
  const first = hits[0];
  if (first === undefined) throw new Error(`未找到通道滑杆：${channel}`);
  return first;
}

/** 按 `data-setting` 取单值控件（静音 / 文字速度） */
function settingInput(container: FakeNode, setting: string): FakeNode {
  const hits = findAll(
    container,
    (node) => node.dataset.setting === setting && node.tagName === "INPUT",
  );
  const first = hits[0];
  if (first === undefined) throw new Error(`未找到控件：${setting}`);
  return first;
}

/** 面板根节点 = 容器里 class 为 prefs-panel 的 section */
function panelRoot(container: FakeNode): FakeNode {
  const hits = findAll(
    container,
    (node) => node.className === "prefs-panel" && node.tagName === "SECTION",
  );
  const first = hits[0];
  if (first === undefined) throw new Error("未找到面板根节点");
  return first;
}

// ---------- 被测装置的装配 ----------

type PrefsListener = Parameters<PlayerPreferences["onChange"]>[0];

interface Harness {
  /** 真实偏好状态机（无端口 = 纯内存，不落盘、不排定时器） */
  prefs: PlayerPreferences;
  container: FakeNode;
  panel: PreferencesPanel;
  /** 当前活跃订阅数（观测 mount/destroy 是否成对） */
  activeListeners(): number;
}

/**
 * 计数版偏好端口：真实 `PlayerPreferences` + 一层订阅计数。
 * 订阅本身仍由核心实现，这里只在外壳上记「加了几次、减了几次」——
 * 否则「destroy 已退订」只能靠行为间接推，断言不到解绑本身。
 */
function setup(): Harness {
  const prefs = new PlayerPreferences();
  let active = 0;
  const subscribe = prefs.onChange.bind(prefs);
  prefs.onChange = (listener: PrefsListener): (() => void) => {
    active += 1;
    const off = subscribe(listener);
    let done = false;
    return (): void => {
      if (done) return; // 退订幂等（核心的 Set.delete 本就幂等，这里同口径记账）
      done = true;
      active -= 1;
      off();
    };
  };

  const container = createFakeNode("div");
  const panel = createPreferencesPanel({
    preferences: prefs,
    container: container as unknown as HTMLElement,
  });
  return { prefs, container, panel, activeListeners: () => active };
}

/** 期望的默认视图（与 `DEFAULT_PLAYER_PREFS` 同源，不在这里抄一份数字） */
function defaultView(): PreferencesPanelView {
  return {
    volumes: { ...DEFAULT_PLAYER_PREFS.volumes },
    muted: DEFAULT_PLAYER_PREFS.muted,
    textSpeed: DEFAULT_PLAYER_PREFS.textSpeed,
    channels: ["bgm", "se", "ambient", "voice"],
  };
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFakeNode(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- ① 视图层 ----------

describe("偏好面板视图（纯数据）", () => {
  it("**初值 = 默认偏好**（bgm .8 / se .6 / ambient .8 / voice 1，未静音，字速 30）", () => {
    const h = setup();
    expect(h.panel.view()).toEqual(defaultView());
    // 逐项点名，别只靠对象全等：默认值若被改，这条能指出是哪个通道
    expect(h.panel.view().volumes).toEqual({
      bgm: 0.8,
      se: 0.6,
      ambient: 0.8,
      voice: 1,
    });
    expect(h.panel.view().muted).toBe(false);
    expect(h.panel.view().textSpeed).toBe(30);
  });

  it("**通道展示序固定四通道**（与 PREF_CHANNELS 同序，不受偏好内容影响）", () => {
    const h = setup();
    expect(h.panel.view().channels).toEqual(["bgm", "se", "ambient", "voice"]);
    expect(h.panel.view().channels).toEqual(
      PREF_CHANNELS.map((entry) => entry.channel),
    );
  });

  it("**外部改偏好后视图现读**（不缓存副本；两次快照不是同一对象）", () => {
    const h = setup();
    const before = h.panel.view();

    h.prefs.setVolume("bgm", 0.3);
    const after = h.panel.view();

    expect(after.volumes.bgm).toBe(0.3);
    // 其余通道不受影响（改一个通道不该动别的）
    expect(after.volumes.se).toBe(DEFAULT_PLAYER_PREFS.volumes.se);
    // 缓存实现会返回同一个对象引用 → 这条会红
    expect(after).not.toBe(before);
    expect(after.volumes).not.toBe(before.volumes);
    // 每次调用都是新引用：调用方改写它不得穿透偏好状态
    after.volumes.bgm = 0.99;
    expect(h.panel.view().volumes.bgm).toBe(0.3);
  });

  it("静音与字速同样现读（外部写入即时可见）", () => {
    const h = setup();
    h.prefs.setMuted(true);
    h.prefs.setTextSpeed(12);
    expect(h.panel.view().muted).toBe(true);
    expect(h.panel.view().textSpeed).toBe(12);
  });

  it("**未挂载也能取视图**（视图计算与 DOM 解耦）", () => {
    const h = setup();
    expect(h.container.children).toEqual([]);
    expect(h.panel.view()).toEqual(defaultView());
    // 挂了控件之后视图口径不变（同一份数据来源）
    h.panel.mount();
    expect(h.panel.view()).toEqual(defaultView());
  });
});

// ---------- ② DOM 层 ----------

describe("偏好面板控件（挂载 / 回填 / 回写）", () => {
  it("挂载后按当前偏好回填控件（四通道 + 静音 + 字速）", () => {
    const h = setup();
    h.panel.mount();

    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      const input = volumeInput(h.container, channel);
      expect(input.value).toBe(String(DEFAULT_PLAYER_PREFS.volumes[channel]));
      expect(input.type).toBe("range");
      expect(input.min).toBe("0");
      expect(input.max).toBe("1");
      expect(input.disabled).toBe(false);
    }
    expect(settingInput(h.container, "muted").checked).toBe(false);
    expect(settingInput(h.container, "text-speed").value).toBe(
      String(DEFAULT_PLAYER_PREFS.textSpeed),
    );

    // 行标签顺序 = 通道展示序在前、两个单项在后（面板可读性的最低保证）
    const labels = findAll(
      h.container,
      (node) => node.className === "prefs-label",
    );
    expect(labels.map((node) => node.textContent)).toEqual([
      ...PREF_CHANNELS.map((entry) => entry.label),
      "静音",
      "文字速度",
    ]);
  });

  it("**偏好变化后控件被回填**（订阅生效，不只是 view() 现读）", () => {
    const h = setup();
    h.panel.mount();

    h.prefs.setVolume("se", 0.42);
    expect(volumeInput(h.container, "se").value).toBe("0.42");
    // 读数也刷：控件值一致但文字没刷就是半个同步
    const readout = findAll(
      h.container,
      (node) => node.className === "prefs-value" && node.textContent === "42%",
    );
    expect(readout).toHaveLength(1);
  });

  it("静音时四通道滑杆禁用（通道偏好保留，但拖它看不出效果）", () => {
    const h = setup();
    h.panel.mount();
    h.prefs.setMuted(true);
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      expect(volumeInput(h.container, channel).disabled).toBe(true);
      // 禁用只影响可操作性：偏好值不被改写
      expect(h.panel.view().volumes[channel]).toBe(
        DEFAULT_PLAYER_PREFS.volumes[channel],
      );
    }
    expect(settingInput(h.container, "muted").checked).toBe(true);
  });

  it("拖动音量滑杆 → 写进偏好层（钳制归偏好层，本层不重复钳）", () => {
    const h = setup();
    h.panel.mount();

    const bgm = volumeInput(h.container, "bgm");
    bgm.value = "0.35";
    bgm.fire("input");
    expect(h.prefs.volume("bgm")).toBe(0.35);
    expect(h.panel.view().volumes.bgm).toBe(0.35);

    // 越界值由 clamp01 兜：本层不自己截断，但结果必须是钳过的
    bgm.value = "7";
    bgm.fire("input");
    expect(h.prefs.volume("bgm")).toBe(1);
    bgm.value = "-3";
    bgm.fire("input");
    expect(h.prefs.volume("bgm")).toBe(0);
  });

  it('**空滑杆值不改通道**（`Number("")` 是 0，直接写会把通道误调成静音）', () => {
    const h = setup();
    h.panel.mount();

    const ambient = volumeInput(h.container, "ambient");
    ambient.value = "";
    ambient.fire("input");
    expect(h.prefs.volume("ambient")).toBe(
      DEFAULT_PLAYER_PREFS.volumes.ambient,
    );
  });

  it("静音开关与字速滑杆各自落到对应 setter", () => {
    const h = setup();
    h.panel.mount();

    const muted = settingInput(h.container, "muted");
    muted.checked = true;
    muted.fire("change");
    expect(h.prefs.muted).toBe(true);

    const speed = settingInput(h.container, "text-speed");
    speed.value = "45";
    speed.fire("input");
    expect(h.prefs.textSpeed).toBe(45);

    // 字速下限归偏好层（1），本层同样不重复钳
    speed.value = "0";
    speed.fire("input");
    expect(h.prefs.textSpeed).toBe(1);
  });
});

// ---------- ③ 生命周期层 ----------

describe("偏好面板生命周期（幂等挂载 / 真退订）", () => {
  it("**面板根节点与容器都带 data-ui-zone**（否则滚轮会连带触发故事回溯）", () => {
    const h = setup();
    h.panel.mount();
    // `dataset.uiZone` ↔ 属性 `data-ui-zone`（camelCase ↔ kebab-case 标准映射）
    expect(panelRoot(h.container).dataset.uiZone).not.toBeUndefined();
    expect(h.container.dataset.uiZone).not.toBeUndefined();
  });

  it("**mount() 幂等**：重复调用只建一棵子树、只订阅一次", () => {
    const h = setup();
    h.panel.mount();
    h.panel.mount();
    h.panel.mount();

    expect(h.container.children).toHaveLength(1);
    expect(
      findAll(h.container, (node) => node.className === "prefs-panel"),
    ).toHaveLength(1);
    // 四通道各一根滑杆，没有叠成 8 / 12 根
    expect(
      findAll(h.container, (node) => node.dataset.channel !== undefined),
    ).toHaveLength(4);
    // 重复订阅会让一次偏好变化回填多次；订阅数是最直接的证据
    expect(h.activeListeners()).toBe(1);
  });

  it("**destroy() 清空容器并真退订**：之后再改偏好既不抛也不回填", () => {
    const h = setup();
    h.panel.mount();
    const staleBgm = volumeInput(h.container, "bgm");
    expect(h.activeListeners()).toBe(1);

    h.panel.destroy();
    expect(h.container.children).toEqual([]);
    expect(h.container.textContent).toBe("");
    expect(h.activeListeners()).toBe(0);

    // 已卸下的面板若还挂着监听，这次写入会打到已摘除的节点上（症状 = 抛错或写旧值）
    expect(() => {
      h.prefs.setVolume("bgm", 0.1);
      h.prefs.setMuted(true);
      h.prefs.setTextSpeed(5);
    }).not.toThrow();
    expect(h.container.children).toEqual([]);
    expect(staleBgm.value).toBe(String(DEFAULT_PLAYER_PREFS.volumes.bgm));
  });

  it("destroy() 幂等，且之后可再次 mount()（重新建控件、重新订阅）", () => {
    const h = setup();
    h.panel.mount();
    h.panel.destroy();
    expect(() => h.panel.destroy()).not.toThrow();
    expect(h.activeListeners()).toBe(0);

    h.prefs.setVolume("voice", 0.25);
    h.panel.mount();
    expect(h.activeListeners()).toBe(1);
    expect(h.container.children).toHaveLength(1);
    // 重新挂载读的是**当前**偏好，不是挂载前的旧值
    expect(volumeInput(h.container, "voice").value).toBe("0.25");
  });

  it("偏好载荷里的可选字段不影响视图（面板只看自己那四项）", () => {
    const h = setup();
    h.prefs.setFullscreen(true);
    const view = h.panel.view();
    // 视图形状收敛：多出来的偏好字段不得混进面板视图
    expect(Object.keys(view).sort()).toEqual(
      ["channels", "muted", "textSpeed", "volumes"].sort(),
    );
  });
});

// ---------- ④ 源码闸门（框架无关是模板骨架的定位） ----------

describe("模板面板保持框架无关", () => {
  it("**不 import 任何 UI 框架 / Tauri API**", () => {
    expect(panelSource).not.toMatch(
      /from\s+["'](vue|vue-[^"']*|pinia|@vue\/[^"']*|react[^"']*|@tauri-apps\/[^"']*)["']/,
    );
  });

  it("**只走偏好的既有写入口**（不自建状态、不直写载荷）", () => {
    expect(panelSource).toContain("setVolume");
    expect(panelSource).toContain("setMuted");
    expect(panelSource).toContain("setTextSpeed");
    // 面板不该自己钳制/自建一份偏好真值：钳制归 PlayerPreferences（clamp01）
    expect(panelSource).not.toMatch(/clamp01/);
    expect(panelSource).not.toMatch(/DEFAULT_PLAYER_PREFS/);
  });
});
