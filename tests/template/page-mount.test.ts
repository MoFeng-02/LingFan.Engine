/**
 * 页面挂载器：列切换时挂载/卸载页面，且**切走即真销毁**。
 *
 * 这组判据守的是那条设计决定：页面切换是「完整界面替换」，不是显示切换。
 * 三条主线，各自锁不同的失败模式：
 * - **真销毁**：卸载后容器子节点数为 0，旧页面自己的根节点也不在树里。锁的是「只把
 *   旧界面藏起来」——那种实现在功能上看起来一样，但内存与「此刻在哪个界面」的答案都坏了。
 * - **顺序**：先卸载旧的，再挂载新的。锁的是「先挂后卸」——同时存在两个页面的瞬间会
 *   让焦点、滚动位置、无障碍树都出现两个答案。
 * - **同列不重挂**：列 id 不变（同列里推进、热重载重进同列）时既不解挂也不重挂。锁的是
 *   「每帧重挂」——那会让页面内部状态每帧清零，比不挂还糟。
 *
 * 另有一条**源码互锁**：`mount.ts` 里不得出现隐藏式切换的痕迹（`display` / `visibility` /
 * 把页面实例存进 Map 留待复用）。这条断言是那条设计决定的机器化，而不是靠注释提醒——
 * 注释拦不住下一个想「小优化一下」的人。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入。替身只实现挂载器真正用到的那几个成员（`childElementCount` /
 * `replaceChildren` 按真实 DOM 语义实现）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mountSource from "../../template/v1/__PROJECT__/src/host/pages/mount.ts?raw";
import {
  createPageMounter,
  type PageMounter,
} from "../../template/v1/__PROJECT__/src/host/pages/mount.ts";
import { createPageRegistry } from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";
import type {
  Page,
  PageRegistry,
} from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";
import type {
  GameStateWriter,
  PlayerPreferences,
  StateReader,
  StoryEngine,
} from "@lingfan-engine/core";
import { SYS } from "@lingfan-engine/core";

// ---------- 最小 DOM 替身 ----------

interface FakeElement {
  tagName: string;
  children: FakeElement[];
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
  readonly childElementCount: number;
  replaceChildren(): void;
}

function createFakeElement(tag: string): FakeElement {
  const attributes = new Map<string, string>();
  const element = {
    tagName: tag.toUpperCase(),
    children: [] as FakeElement[],
    attributes,
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    hasAttribute(name: string): boolean {
      return attributes.has(name);
    },
    appendChild(child: FakeElement): FakeElement {
      element.children.push(child);
      return child;
    },
    removeChild(child: FakeElement): FakeElement {
      const index = element.children.indexOf(child);
      if (index < 0) throw new Error("removeChild: 不是本节点的子节点");
      element.children.splice(index, 1);
      return child;
    },
    get childElementCount(): number {
      return element.children.length;
    },
    replaceChildren(): void {
      element.children.length = 0;
    },
  } as unknown as FakeElement;
  return element;
}

// ---------- 引擎与读口替身 ----------

interface FakeEngine {
  listener: ((change: { key: string; value: unknown }) => void) | null;
  unsubscribed: number;
  onStateChanged(
    listener: (change: { key: string; value: unknown }) => void,
  ): () => void;
}

function createFakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    listener: null,
    unsubscribed: 0,
    onStateChanged(listener) {
      engine.listener = listener;
      return () => {
        engine.unsubscribed += 1;
        engine.listener = null;
      };
    },
  };
  return engine;
}

/** 当前列 id 由测试直接摆布；形状校验已在 `reader.currentColumnId` 内部做过，这里只给值 */
interface FakeReader {
  columnId: string;
  currentColumnId(): string;
  currentColumnType(): "game" | "ui";
}

function createFakeReader(): FakeReader {
  return {
    columnId: "",
    currentColumnId() {
      return this.columnId;
    },
    currentColumnType() {
      return "game";
    },
  };
}

// ---------- 页面工厂（记录调用序列） ----------

interface Spies {
  /** 全局调用序列：`mount:<列 id>` / `unmount:<列 id>` */
  calls: string[];
  /** 每次 mount 拿到的容器 */
  containers: FakeElement[];
}

/**
 * 造一个记录调用序列的页面工厂。
 *
 * 页面自己往容器里放一个根节点——这样「容器是否被清空」与「页面根是否还在」是两个
 * 独立可判据：前者是宿主兜底，后者是页面自己的 `unmount`。两条都要成立才算真销毁。
 */
function pageFactory(spies: Spies, columnId: string): () => Page {
  return (): Page => {
    let root: FakeElement | null = null;
    return {
      mount(container: HTMLElement): void {
        spies.calls.push(`mount:${columnId}`);
        const fakeContainer = container as unknown as FakeElement;
        spies.containers.push(fakeContainer);
        root = createFakeElement("div");
        fakeContainer.appendChild(root);
      },
      unmount(): void {
        spies.calls.push(`unmount:${columnId}`);
        if (root !== null) {
          // 页面自己负责摘掉自己的节点（Vue/React 的卸载钩子在这一步生效）
          const parent = spies.containers[spies.containers.length - 1];
          if (parent !== undefined && parent.children.includes(root)) {
            parent.removeChild(root);
          }
          root = null;
        }
      },
    };
  };
}

// ---------- 组装配件 ----------

interface Harness {
  engine: FakeEngine;
  reader: FakeReader;
  registry: PageRegistry;
  container: FakeElement;
  mounter: PageMounter;
  spies: Spies;
  errors: string[];
}

function buildHarness(
  register: (registry: PageRegistry, spies: Spies) => void,
): Harness {
  const engine = createFakeEngine();
  const reader = createFakeReader();
  const registry = createPageRegistry();
  const container = createFakeElement("div");
  const spies: Spies = { calls: [], containers: [] };
  const errors: string[] = [];
  register(registry, spies);
  const mounter = createPageMounter({
    registry,
    container: container as unknown as HTMLElement,
    engine: engine as unknown as StoryEngine,
    reader: reader as unknown as StateReader,
    preferences: {} as PlayerPreferences,
    gameState: {} as GameStateWriter,
    reportError: (message) => errors.push(message),
  });
  return { engine, reader, registry, container, mounter, spies, errors };
}

/** 模拟「引擎把当前列改成某列」：改读口的值再发一条状态变更 */
function switchColumn(harness: Harness, columnId: string): void {
  harness.reader.columnId = columnId;
  harness.engine.listener?.({ key: SYS.currentSceneColumn, value: columnId });
}

// ---------- 生命周期 ----------

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFakeElement(tag),
    querySelector: () => null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- 判据 ----------

describe("页面挂载器 · 列切换挂载 / 卸载", () => {
  it("从 game 列进 menu 列：先卸载旧页面，再挂载新页面（顺序不能反）", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    switchColumn(harness, "play");
    expect(harness.spies.calls).toEqual(["mount:play"]);

    switchColumn(harness, "main_menu");
    // 顺序断言：两个页面不同时存在
    expect(harness.spies.calls).toEqual([
      "mount:play",
      "unmount:play",
      "mount:main_menu",
    ]);
  });

  it("真销毁：卸载后容器子节点数为 0，且旧页面的根节点已不在容器里", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    switchColumn(harness, "play");
    expect(harness.container.childElementCount).toBe(1);
    const oldRoot = harness.container.children[0]!;

    switchColumn(harness, "main_menu");
    // 新页面此刻正占着容器：子节点数又是 1，但**不是**旧那个
    expect(harness.container.childElementCount).toBe(1);
    expect(harness.container.children).not.toContain(oldRoot);
  });

  it("页面自己的 unmount 漏了清理时，宿主兜底清空容器（真销毁的最终保证）", () => {
    const harness = buildHarness((registry) => {
      // 故意写一个只记日志、不摘节点的坏页面
      registry.register("play", () => ({
        mount(container: HTMLElement): void {
          (container as unknown as FakeElement).appendChild(
            createFakeElement("div"),
          );
        },
        unmount(): void {
          // 什么都不做：这才是要防的写法
        },
      }));
    });

    switchColumn(harness, "play");
    expect(harness.container.childElementCount).toBe(1);

    switchColumn(harness, "");
    // 没有新页面挂上来，但旧页面的残留节点也必须没了
    expect(harness.container.childElementCount).toBe(0);
  });

  it("未注册列 = 回落 op 渲染：容器清空，不抛错也不上报", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
    });

    switchColumn(harness, "play");
    switchColumn(harness, "chapter1");

    expect(harness.spies.calls).toEqual(["mount:play", "unmount:play"]);
    expect(harness.container.childElementCount).toBe(0);
    expect(harness.errors).toEqual([]);
  });
});

describe("页面挂载器 · 同列不重挂", () => {
  it("同一列内推进（列 id 不变）既不卸载也不重挂", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    switchColumn(harness, "main_menu");
    const mountedRoot = harness.container.children[0]!;

    // 三次「同列状态变更」（真实来源是同列里推进或热重载重进同列）
    for (let index = 0; index < 3; index += 1) {
      harness.engine.listener?.({
        key: SYS.currentSceneColumn,
        value: "main_menu",
      });
    }

    expect(harness.spies.calls).toEqual(["mount:main_menu"]);
    // 根节点身份不变：证明是同一个页面实例，不是卸载后重挂的等价物
    expect(harness.container.children[0]).toBe(mountedRoot);
  });

  it("装配期就已在某列时，构造即对齐（不必等第一次状态变更）", () => {
    const engine = createFakeEngine();
    const reader = createFakeReader();
    reader.columnId = "main_menu";
    const registry = createPageRegistry();
    const spies: Spies = { calls: [], containers: [] };
    registry.register("main_menu", pageFactory(spies, "main_menu"));
    const container = createFakeElement("div");

    createPageMounter({
      registry,
      container: container as unknown as HTMLElement,
      engine: engine as unknown as StoryEngine,
      reader: reader as unknown as StateReader,
      preferences: {} as PlayerPreferences,
      gameState: {} as GameStateWriter,
      reportError: () => undefined,
    });

    expect(spies.calls).toEqual(["mount:main_menu"]);
  });
});

describe("页面挂载器 · 容器与活区标记", () => {
  it("容器常驻并带 data-ui-zone（缺了滚轮会连带触发故事回溯）", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    expect(harness.container.hasAttribute("data-ui-zone")).toBe(true);
    const attributeBefore = harness.container.attributes.get("data-ui-zone");

    switchColumn(harness, "play");
    switchColumn(harness, "main_menu");

    // 切换只动子节点：容器身份与它的活区标记都不变
    expect(harness.container.attributes.get("data-ui-zone")).toBe(
      attributeBefore,
    );
  });
});

describe("页面挂载器 · 失败隔离", () => {
  it("页面 mount 抛错：上报诊断、清空容器，且下一次切换照常工作", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("broken", () => ({
        mount(): void {
          throw new Error("组件树炸了");
        },
        unmount(): void {
          spies.calls.push("unmount:broken");
        },
      }));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    switchColumn(harness, "broken");
    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]).toContain("页面挂载失败：列 broken");
    expect(harness.container.childElementCount).toBe(0);

    // 坏页面不该被记成"当前页面"：半挂载实例只被清理这一次，切换时不再卸它第二次
    switchColumn(harness, "main_menu");
    expect(harness.spies.calls).toEqual(["unmount:broken", "mount:main_menu"]);
  });

  it("页面 unmount 抛错：上报诊断，但容器照样清空、下一个页面照样能挂", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", () => ({
        mount(container: HTMLElement): void {
          (container as unknown as FakeElement).appendChild(
            createFakeElement("div"),
          );
        },
        unmount(): void {
          throw new Error("清理时炸了");
        },
      }));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    switchColumn(harness, "play");
    switchColumn(harness, "main_menu");

    expect(
      harness.errors.some((line) => line.includes("页面卸载失败：列 play")),
    ).toBe(true);
    expect(harness.spies.calls).toEqual(["mount:main_menu"]);
    expect(harness.container.childElementCount).toBe(1);
  });
});

describe("页面挂载器 · 拆除", () => {
  it("dispose 卸载当前页面、退订状态，且幂等", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
    });

    switchColumn(harness, "play");
    harness.mounter.dispose();

    expect(harness.spies.calls).toEqual(["mount:play", "unmount:play"]);
    expect(harness.container.childElementCount).toBe(0);
    expect(harness.engine.unsubscribed).toBe(1);

    // 幂等：第二次调用不再卸载、不再退订
    harness.mounter.dispose();
    expect(harness.spies.calls).toEqual(["mount:play", "unmount:play"]);
  });

  it("拆除后状态变更不再引起挂载", () => {
    const harness = buildHarness((registry, spies) => {
      registry.register("play", pageFactory(spies, "play"));
      registry.register("main_menu", pageFactory(spies, "main_menu"));
    });

    harness.mounter.dispose();
    switchColumn(harness, "main_menu");

    expect(harness.spies.calls).toEqual([]);
  });
});

describe("页面挂载器 · 源码互锁（禁止假切换）", () => {
  it("不出现隐藏式切换的痕迹（display / visibility / 缓存页面待复用）", () => {
    // 这三条正是「假切换」的三种典型写法：藏起来、改成不可见、留在表里下次复用
    expect(mountSource).not.toMatch(/\bdisplay\b/);
    expect(mountSource).not.toMatch(/\bvisibility\b/);
    // 页面实例只存在单个 current 槽位里，不得存进 Map/数组等待复用
    expect(mountSource).not.toMatch(/new Map<[^>]*Page/);
    expect(mountSource).not.toMatch(/\bpageCache\b/);
  });

  it("卸载走页面的 unmount，并兜底清空容器（两道保险都在）", () => {
    expect(mountSource).toContain(".unmount()");
    expect(mountSource).toContain("replaceChildren");
  });

  it("只认一个状态键：SYS.currentSceneColumn（不订阅别的东西来驱动切换）", () => {
    expect(mountSource).toContain("SYS.currentSceneColumn");
    // 订阅回调里应当先判键；出现第二个 key 比较即意味着挂载器在管别的事
    const keyComparisons = mountSource.match(/key\s*!==\s*SYS\./g) ?? [];
    expect(keyComparisons).toHaveLength(1);
  });
});
