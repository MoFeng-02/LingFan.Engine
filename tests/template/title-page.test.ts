/**
 * 标记界面：`ui` 列由整屏页面渲染，与 `game` 列的 op 渲染互不干扰。
 *
 * 这组判据守的是「页面」这一类的最小可用形态，四条主线各自锁不同的失败模式：
 * - **双向能力**：页面能读状态（`reader.currentColumnId()`）也能下命令
 *   （`navigate` / `load`）。锁的是「页面只能看不能动」或反过来「页面直接写状态键」——
 *   后者绕过了保留键守卫与快照一致性。
 * - **真销毁**：`unmount` 解绑监听器、摘掉自己建的节点，且幂等。锁的是「只把根节点
 *   摘了、监听器还挂在按钮上」——那种实现在功能上看起来一样，但每次切换都漏一份闭包。
 * - **按列 id 绑定**：页面注册在某个列 id 上，引擎进那一列就挂它，和 `type` 无关。
 *   锁的是「按 type 挂页面」——那样同一个界面在 game 列上也得挂，语义就乱了。
 * - **两形态对等**：原生版与 Vue 版的能力面逐条一致（读状态 / 两个命令 / 真卸载）。
 *   锁的是「示范代码只演示了一半」。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入。替身只实现标题页真正用到的那几个成员，`replaceChildren` 按真实 DOM 语义实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import titlePageSource from "../../template/v1/__PROJECT__/src/host/pages/title-page.ts?raw";
import { createTitlePage } from "../../template/v1/__PROJECT__/src/host/pages/title-page.ts";
import { createPageMounter } from "../../template/v1/__PROJECT__/src/host/pages/mount.ts";
import { createPageRegistry } from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";
import type { PageContext } from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";
import skeletonMainSource from "../../template/v1/__PROJECT__/src/main.ts?raw";
import vueMainSource from "../../template/v1/overlays/vue/src/main.ts?raw";
import vueTitlePageSource from "../../template/v1/overlays/vue/src/pages/title-page.vue?raw";
import storySource from "../../template/v1/__PROJECT__/Resources/Stories/title/title_main.story?raw";
import { parseTextStory } from "@lingfan-engine/core";

// ---------- 最小 DOM 替身 ----------

interface FakeElement {
  tagName: string;
  className: string;
  textContent: string;
  children: FakeElement[];
  listeners: Map<string, Set<() => void>>;
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  appendChild(child: FakeElement): FakeElement;
  replaceChildren(): void;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
  readonly childElementCount: number;
  /** 测试用：模拟点击 */
  click(): void;
}

function createFakeElement(tag: string): FakeElement {
  const listeners = new Map<string, Set<() => void>>();
  const attributes = new Map<string, string>();
  const element = {
    tagName: tag.toUpperCase(),
    className: "",
    textContent: "",
    children: [] as FakeElement[],
    listeners,
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
    replaceChildren(): void {
      element.children.length = 0;
    },
    addEventListener(type: string, handler: () => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: () => void): void {
      listeners.get(type)?.delete(handler);
    },
    get childElementCount(): number {
      return element.children.length;
    },
    click(): void {
      for (const handler of [...(listeners.get("click") ?? [])]) handler();
    },
  } as unknown as FakeElement;
  return element;
}

/** 在整棵子树里按类名找第一个节点 */
function findByClass(
  root: FakeElement,
  className: string,
): FakeElement | undefined {
  if (root.className === className) return root;
  for (const child of root.children) {
    const hit = findByClass(child, className);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// ---------- 页面上下文替身 ----------

interface Spies {
  navigated: string[];
  loaded: string[];
  columnId: string;
}

function createContext(spies: Spies): PageContext {
  const reader = {
    currentColumnId: () => spies.columnId,
    currentColumnType: () => "ui" as const,
  };
  const engine = {
    navigate: (columnId: string) => {
      spies.navigated.push(columnId);
    },
    choose: () => true,
    input: () => true,
    save: () => true,
    load: (slot: string) => {
      spies.loaded.push(slot);
      return true;
    },
  };
  return {
    reader: reader as unknown as PageContext["reader"],
    engine: engine as unknown as PageContext["engine"],
    preferences: {} as PageContext["preferences"],
    gameState: {} as PageContext["gameState"],
  };
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

// ---------- 原生版：能力面 ----------

describe("标题页（原生）· 读写能力", () => {
  it("挂载后容器里有且只有一个整屏根节点，标题文案按配置落地", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "title_main" };
    const container = createFakeElement("div");
    const page = createTitlePage({ title: "我的游戏", subtitle: "副标题" })(
      createContext(spies),
    );

    page.mount(container as unknown as HTMLElement, createContext(spies));

    expect(container.childElementCount).toBe(1);
    const root = container.children[0]!;
    expect(root.className).toBe("page-title");
    expect(findByClass(root, "page-title__heading")?.textContent).toBe(
      "我的游戏",
    );
    expect(findByClass(root, "page-title__subtitle")?.textContent).toBe(
      "副标题",
    );
  });

  it("读状态：「当前界面」取自 reader.currentColumnId()，空串时退回提示文案", () => {
    const container = createFakeElement("div");
    const atTitle: Spies = {
      navigated: [],
      loaded: [],
      columnId: "title_main",
    };
    createTitlePage()(createContext(atTitle)).mount(
      container as unknown as HTMLElement,
      createContext(atTitle),
    );
    const root = container.children[0]!;
    expect(findByClass(root, "page-title__progress")?.textContent).toContain(
      "title_main",
    );

    const empty = createFakeElement("div");
    const noPlace: Spies = { navigated: [], loaded: [], columnId: "" };
    createTitlePage({ emptyHint: "还没开始" })(createContext(noPlace)).mount(
      empty as unknown as HTMLElement,
      createContext(noPlace),
    );
    expect(
      findByClass(empty.children[0]!, "page-title__progress")?.textContent,
    ).toBe("还没开始");
  });

  it("写命令：「开始游戏」调 navigate(目标列)，「继续」调 load(auto 槽)", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "title_main" };
    const container = createFakeElement("div");
    const page = createTitlePage({
      nextColumnId: "chapter1",
      autoSlot: "auto",
    })(createContext(spies));
    page.mount(container as unknown as HTMLElement, createContext(spies));

    const root = container.children[0]!;
    findByClass(root, "page-title__start")!.click();
    findByClass(root, "page-title__continue")!.click();

    expect(spies.navigated).toEqual(["chapter1"]);
    expect(spies.loaded).toEqual(["auto"]);
  });
});

describe("标题页（原生）· 真销毁", () => {
  it("unmount 解绑点击监听并摘掉自己建的节点", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "title_main" };
    const container = createFakeElement("div");
    const page = createTitlePage()(createContext(spies));
    page.mount(container as unknown as HTMLElement, createContext(spies));
    const root = container.children[0]!;
    const start = findByClass(root, "page-title__start")!;

    page.unmount();

    expect(container.childElementCount).toBe(0);
    expect(start.listeners.get("click")?.size ?? 0).toBe(0);
  });

  it("unmount 幂等：第二次调用不抛，也不影响已经清空的容器", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "title_main" };
    const container = createFakeElement("div");
    const page = createTitlePage()(createContext(spies));
    page.mount(container as unknown as HTMLElement, createContext(spies));

    page.unmount();
    expect(() => page.unmount()).not.toThrow();
    expect(container.childElementCount).toBe(0);
  });

  it("卸载后再次挂载是新实例：旧实例的解绑不影响新实例的按钮", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "title_main" };
    const container = createFakeElement("div");
    const factory = createTitlePage();

    const first = factory(createContext(spies));
    first.mount(container as unknown as HTMLElement, createContext(spies));
    first.unmount();

    const second = factory(createContext(spies));
    second.mount(container as unknown as HTMLElement, createContext(spies));
    findByClass(container.children[0]!, "page-title__start")!.click();

    expect(spies.navigated).toEqual(["chapter1"]);
  });
});

// ---------- 挂载器 × 标题页：按列 id 绑定 ----------

describe("标题页（原生）· 按列 id 挂载", () => {
  it("引擎进 title_main 就挂页面，离开就卸载；game 列不挂", () => {
    const spies: Spies = { navigated: [], loaded: [], columnId: "" };
    const container = createFakeElement("div");
    const registry = createPageRegistry();
    registry.register("title_main", createTitlePage());
    // 收进数组而不是单个变量：控制流分析会把「只在回调里赋值的 let」当成恒空，
    // 那样调用点直接报 not callable，与运行期事实不符。
    const listeners: ((change: { key: string; value: unknown }) => void)[] = [];
    const engine = {
      onStateChanged(
        notify: (change: { key: string; value: unknown }) => void,
      ) {
        listeners.push(notify);
        return () => {
          const index = listeners.indexOf(notify);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    };
    const reader = {
      currentColumnId: () => spies.columnId,
      currentColumnType: () => "ui" as const,
    };
    const mounter = createPageMounter({
      registry,
      container: container as unknown as HTMLElement,
      engine: engine as unknown as PageContext["engine"] as never,
      reader: reader as unknown as PageContext["reader"],
      preferences: {} as PageContext["preferences"],
      gameState: {} as PageContext["gameState"],
      reportError: () => undefined,
    });

    spies.columnId = "title_main";
    listeners[0]?.({ key: "__current_scene_column", value: "title_main" });
    expect(container.childElementCount).toBe(1);

    // 进 game 列：未注册 ⇒ 回落 op 渲染，页面被真卸载
    spies.columnId = "chapter1";
    listeners[0]?.({ key: "__current_scene_column", value: "chapter1" });
    expect(container.childElementCount).toBe(0);

    mounter.dispose();
  });
});

// ---------- Vue 版：两形态对等 ----------

describe("标题页（Vue）· 与原生版对等", () => {
  it("能力面逐条对齐：读当前列 id + navigate + load", () => {
    expect(vueTitlePageSource).toContain("currentColumnId()");
    expect(vueTitlePageSource).toContain('navigate("chapter1")');
    expect(vueTitlePageSource).toContain('load("auto")');
  });

  it("卸载走 Vue 自己的 unmount（不留后台实例）", () => {
    expect(vueMainSource).toContain("app.unmount()");
    // 挂载与卸载成对出现，且不放模块级缓存
    expect(vueMainSource).toContain("app.mount(container)");
    expect(vueMainSource).not.toMatch(/const\s+apps\s*=\s*new Map/);
  });

  it("两形态都注册在同一个列 id 上，且都把页面表交给 bootHost", () => {
    expect(skeletonMainSource).toContain('pages.register(\n    "title_main"');
    expect(vueMainSource).toContain('pages.register("title_main"');
    expect(skeletonMainSource).toContain("pages: createPages()");
    expect(vueMainSource).toContain("pages: createPages()");
  });
});

// ---------- 故事侧：ui 列是界面，chapter1 是正文 ----------

describe("模板故事 · 界面列与正文列分工", () => {
  it("title_main 是 ui 列，chapter1 与 stage_demo 是 game 列（缺省不写 type）", () => {
    const story = parseTextStory(storySource);
    const byId = new Map(story.columns.map((column) => [column.id, column]));

    expect(byId.get("title_main")?.type).toBe("ui");
    expect(byId.get("chapter1")?.type ?? "game").toBe("game");
    expect(byId.get("stage_demo")?.type ?? "game").toBe("game");
  });

  it("入口仍是 title_main：开屏看到的是界面列，不是剧情", () => {
    const story = parseTextStory(storySource);
    expect(
      story.columns.find((column) => column.id === "title_main"),
    ).toBeDefined();
  });
});

// ---------- 源码互锁：页面不许绕开命令面 ----------

describe("标题页（原生）· 源码互锁", () => {
  it("不直接写状态键（只经命令面），不自己造存档格式", () => {
    expect(titlePageSource).not.toMatch(/\bsetSystem\b/);
    expect(titlePageSource).not.toMatch(/\bsetScoped\b/);
    // 连 `SYS` 这层抽象都不该出现：出现即意味着页面在直接读引擎内部键名
    expect(titlePageSource).not.toMatch(/\bSYS\b/);
    // 抽查几个保留键字面量（不全量列，列全了会把没有的键也写成规格）
    expect(titlePageSource).not.toContain("__current_scene_column");
    expect(titlePageSource).not.toContain("__menu_return");
    expect(titlePageSource).not.toContain("localStorage");
  });

  it("unmount 先解绑再摘节点（不把闭包留在按钮上）", () => {
    const unmountAt = titlePageSource.indexOf("unmount(): void {");
    expect(unmountAt).toBeGreaterThan(-1);
    const body = titlePageSource.slice(unmountAt);
    expect(body.indexOf("removeEventListener")).toBeLessThan(
      body.indexOf("replaceChildren"),
    );
  });
});
