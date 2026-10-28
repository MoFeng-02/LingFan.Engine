/**
 * HUD 面板（宿主侧常驻叠加层壳）：可隐藏、不销毁。
 *
 * 三条语义各自锁一处，互不混淆：
 * - **显隐是可见性不是生命周期**：`setVisible(false)` 之后根节点带 `hidden` 属性（浏览器原生
 *   语义，不用 `display:none` 字符串），实例仍在、`mount` 计数仍为 1、内部状态保持；
 *   再 `setVisible(true)` 根节点恢复可见。
 * - **销毁跟游戏页走**：`destroy()` 摘掉根节点、清掉 `data-ui-zone`，且**幂等**；销毁之后
 *   再 `setVisible` / `mount` 不抛（调用方不必为时序做防御）。
 * - **活区标记**：容器与根节点都带 `data-ui-zone`——缺了它，HUD 上的滚轮会连带触发
 *   故事回溯（回溯滚轮见渲染交互契约）。
 *
 * 另有一条**源码互锁**：`hud.ts` 文本里不得出现页面那套销毁语义的词。HUD 不是页面，
 * 一旦有人在里面写上「切走即销毁」的入口，迟早会被当成页面挂到列切换上，于是隐藏变成
 * 重建、内部状态全丢。这条断言是这段判断的机器化，而不是靠注释提醒。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入。替身实现的属性面按真实 DOM 的语义来（`hidden` 是属性不是字段、
 * `appendChild` 建立父子关系、`removeChild` 断开）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import hudSource from "../../template/v1/__PROJECT__/src/host/pages/hud.ts?raw";
import {
  createHudPanel,
  type HudPanel,
} from "../../template/v1/__PROJECT__/src/host/pages/hud.ts";
import type { PageContext } from "../../template/v1/__PROJECT__/src/host/pages/registry.ts";

// ---------- 最小 DOM 替身 ----------

interface FakeElement {
  tagName: string;
  className: string;
  children: FakeElement[];
  /** 属性表：`hidden` / `data-ui-zone` 都落这里（真实 DOM 的 attribute 语义） */
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
  /** 子节点数：容器是否被清空的判据 */
  childCount(): number;
}

function createFakeElement(tag: string): FakeElement {
  const attributes = new Map<string, string>();
  const element = {
    tagName: tag.toUpperCase(),
    className: "",
    children: [] as FakeElement[],
    attributes,
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attributes.has(name) ? attributes.get(name)! : null;
    },
    hasAttribute(name: string): boolean {
      return attributes.has(name);
    },
    removeAttribute(name: string): void {
      attributes.delete(name);
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
    childCount(): number {
      return element.children.length;
    },
  } as unknown as FakeElement;
  return element;
}

// ---------- 被测装置的装配 ----------

/** 页面上下文替身：HUD 壳只把上下文转交，不读它，故给空壳即可 */
function fakeContext(): PageContext {
  return {
    reader: {} as PageContext["reader"],
    engine: {} as PageContext["engine"],
    preferences: {} as PageContext["preferences"],
    gameState: {} as PageContext["gameState"],
  };
}

interface Harness {
  container: FakeElement;
  hud: HudPanel;
  /** `render` 回调被调用的次数：观测「mount 是否被重复执行」的内部状态代理 */
  renderCalls(): number;
  /** `render` 收到过的根节点：观测「实例是否被重建」 */
  roots(): FakeElement[];
}

function setup(): Harness {
  const roots: FakeElement[] = [];
  const hud = createHudPanel({
    render: (root) => {
      roots.push(root as unknown as FakeElement);
      (root as unknown as FakeElement).appendChild(createFakeElement("span"));
    },
  });
  return {
    container: createFakeElement("div"),
    hud,
    renderCalls: () => roots.length,
    roots: () => roots,
  };
}

/** HUD 根节点 = 容器里带 hud-panel 类的 section */
function hudRoot(container: FakeElement): FakeElement {
  const hit = container.children.find(
    (child) => child.tagName === "SECTION" && child.className === "hud-panel",
  );
  if (hit === undefined) throw new Error("未找到 HUD 根节点");
  return hit;
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFakeElement(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HUD 面板", () => {
  it("mount 一次后容器里有 HUD 根节点（含 render 填充的内容）", () => {
    const { container, hud, renderCalls } = setup();

    hud.mount(container as unknown as HTMLElement, fakeContext());

    expect(container.childCount()).toBe(1);
    const root = hudRoot(container);
    expect(root.childCount()).toBe(1);
    expect(renderCalls()).toBe(1);
  });

  it("setVisible(false) 用 hidden 属性隐藏，实例仍存活（mount 不重复、根节点不重建）", () => {
    const { container, hud, renderCalls, roots } = setup();
    hud.mount(container as unknown as HTMLElement, fakeContext());
    const rootBefore = hudRoot(container);

    hud.setVisible(false);

    const rootAfterHide = hudRoot(container);
    expect(rootAfterHide.hasAttribute("hidden")).toBe(true);
    // 根节点没被摘掉、也没被换掉：隐藏不是销毁
    expect(container.childCount()).toBe(1);
    expect(rootAfterHide).toBe(rootBefore);
    expect(renderCalls()).toBe(1);
    expect(roots()).toHaveLength(1);

    hud.setVisible(true);

    const rootAfterShow = hudRoot(container);
    expect(rootAfterShow.hasAttribute("hidden")).toBe(false);
    // 状态保持：还是同一个根节点、render 仍只跑过一次
    expect(rootAfterShow).toBe(rootBefore);
    expect(renderCalls()).toBe(1);
    expect(rootAfterShow.childCount()).toBe(1);
  });

  it("重复 mount 不重复挂载（幂等，不叠节点、不重跑 render）", () => {
    const { container, hud, renderCalls } = setup();
    const ctx = fakeContext();

    hud.mount(container as unknown as HTMLElement, ctx);
    hud.mount(container as unknown as HTMLElement, ctx);

    expect(container.childCount()).toBe(1);
    expect(renderCalls()).toBe(1);
  });

  it("容器与根节点都带 data-ui-zone（缺了它滚轮会触发故事回溯）", () => {
    const { container, hud } = setup();

    hud.mount(container as unknown as HTMLElement, fakeContext());

    expect(container.hasAttribute("data-ui-zone")).toBe(true);
    expect(hudRoot(container).hasAttribute("data-ui-zone")).toBe(true);
  });

  it("活区标记可自定义，且缺省为 hud", () => {
    const custom = createHudPanel({ zone: "hud-battle" });
    const customContainer = createFakeElement("div");
    custom.mount(customContainer as unknown as HTMLElement, fakeContext());
    expect(customContainer.getAttribute("data-ui-zone")).toBe("hud-battle");

    const { container, hud } = setup();
    hud.mount(container as unknown as HTMLElement, fakeContext());
    expect(container.getAttribute("data-ui-zone")).toBe("hud");
  });

  it("destroy 摘掉根节点并清掉活区标记，且幂等", () => {
    const { container, hud } = setup();
    hud.mount(container as unknown as HTMLElement, fakeContext());

    hud.destroy();

    expect(container.childCount()).toBe(0);
    expect(container.hasAttribute("data-ui-zone")).toBe(false);

    // 幂等：再调一次不抛，也不把容器搞坏
    expect(() => hud.destroy()).not.toThrow();
    expect(container.childCount()).toBe(0);
  });

  it("destroy 之后 setVisible / mount 都不抛，且不会把节点挂回来", () => {
    const { container, hud, renderCalls } = setup();
    hud.mount(container as unknown as HTMLElement, fakeContext());
    hud.destroy();

    expect(() => hud.setVisible(false)).not.toThrow();
    expect(() => hud.setVisible(true)).not.toThrow();
    expect(() =>
      hud.mount(container as unknown as HTMLElement, fakeContext()),
    ).not.toThrow();

    // 已销毁的壳不再自我复活：容器保持干净
    expect(container.childCount()).toBe(0);
    expect(renderCalls()).toBe(1);
  });

  it("隐藏态下销毁也摘得干净（不会因为带 hidden 就漏摘）", () => {
    const { container, hud } = setup();
    hud.mount(container as unknown as HTMLElement, fakeContext());
    hud.setVisible(false);

    hud.destroy();

    expect(container.childCount()).toBe(0);
    expect(container.hasAttribute("data-ui-zone")).toBe(false);
  });

  it("源码互锁：hud.ts 不含页面那套销毁语义的词", () => {
    expect(hudSource.length).toBeGreaterThan(500);
    expect(hudSource).not.toContain("unmount");
  });
});
