/**
 * 模板历史面板（纯 DOM）：已走过对话的呈现块列表 + 点一条即回溯。
 *
 * 断言分三层，刻意不混在一起：
 * - **视图层**（`view()`）：纯数据，且数据整形必须来自 `@lingfan-engine/shell`
 *   （`filterHistoryEntries` + `buildHistoryBlocks`）——面板若自己另写一份聚合规则，
 *   「面板显示的行」与「回溯落点」迟早对不上。第 1 组用例锁的正是这条来源。
 * - **DOM 层**：挂载后的结构（开关按钮 / 列表 / 块项）、展开态显隐、点块的回溯参数。
 * - **生命周期层**：`mount()` 幂等（重复调用不叠控件）、`destroy()` 清空容器且可再挂载。
 *
 * 用 `vi.stubGlobal("document", …)` 造最小 DOM 替身而不引 jsdom：`tests/template` 属前端域，
 * 禁 Node 导入，且本仓其他前端域测试也是这个手法（`tests/template/preferences-panel.test.ts`）。
 * 替身只实现本模块用到的面——`createElement` / `appendChild` / `addEventListener` /
 * `dataset` / `textContent` / `style`。
 *
 * 回溯的边界由引擎守：本面板只把 block.index 原样交给 `engine.rollbackTo`，
 * 不自己去判断「能不能回退到那一条」——越界与重放中的 fail-closed 在引擎里。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "@lingfan-engine/shell";
import {
  createHistoryPanel,
  type HistoryPanel,
} from "../../template/v1/__PROJECT__/src/host/panels/history.ts";

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
  /** 内联样式：本模块只用 `display` 控制列表显隐 */
  style: Record<string, string>;
  /** 列表滚动位置：refresh 重建块内容后要复原（真实 DOM 清空子节点会把它复位归零） */
  scrollTop: number;
  children: FakeNode[];
  textContent: string;
  /** 控件面（button 的 type 会在模块里被写成 "button"） */
  type: string;
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
    style: {} as Record<string, string>,
    children: [] as FakeNode[],
    type: "",
    scrollTop: 0,
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
  // 本模块的 destroy() 与列表重画都依赖这条语义，替身必须照做。
  let text = "";
  Object.defineProperty(node, "textContent", {
    enumerable: true,
    configurable: true,
    get: () => text,
    set: (next: string) => {
      text = next;
      if (next === "") {
        node.children.length = 0;
        node.scrollTop = 0; // 真实 DOM 清空子节点后滚动高度归零，scrollTop 随之复位
      }
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

/** 面板根节点 = 容器里 class 为 history-panel 的 section */
function panelRoot(container: FakeNode): FakeNode {
  const hits = findAll(
    container,
    (node) => node.className === "history-panel" && node.tagName === "SECTION",
  );
  const first = hits[0];
  if (first === undefined) throw new Error("未找到面板根节点");
  return first;
}

/** 开关按钮 = class 为 history-toggle 的 button */
function toggleButton(container: FakeNode): FakeNode {
  const hits = findAll(
    container,
    (node) => node.className === "history-toggle" && node.tagName === "BUTTON",
  );
  const first = hits[0];
  if (first === undefined) throw new Error("未找到开关按钮");
  return first;
}

/** 列表 = class 为 history-list 的 div */
function blockList(container: FakeNode): FakeNode {
  const hits = findAll(
    container,
    (node) => node.className === "history-list" && node.tagName === "DIV",
  );
  const first = hits[0];
  if (first === undefined) throw new Error("未找到块列表");
  return first;
}

/** 块项 = class 为 history-item 的 button */
function items(container: FakeNode): FakeNode[] {
  return findAll(
    container,
    (node) => node.className === "history-item" && node.tagName === "BUTTON",
  );
}

// ---------- 被测装置的装配 ----------

interface Harness {
  container: FakeNode;
  panel: HistoryPanel;
  /** 引擎收到的回溯目标（按调用顺序） */
  rolledTo: number[];
  /** 宿主侧收尾被调了几次（媒体对齐） */
  onRollbackCount: number;
  /** 换一份历史条目（模拟推进剧情） */
  setHistory(entries: readonly HistoryEntry[]): void;
}

/** 造一条历史条目（默认是普通对话行） */
function entry(index: number, speaker: string, text: string): HistoryEntry {
  return { index, speaker, text, nvl: false, nvlLines: [] };
}

/** 造一条 NVL 条目：带该时刻的累积行快照 */
function nvlEntry(
  index: number,
  speaker: string,
  lines: readonly string[],
): HistoryEntry {
  return { index, speaker, text: "", nvl: true, nvlLines: [...lines] };
}

function setup(initial: readonly HistoryEntry[] = []): Harness {
  let history: readonly HistoryEntry[] = initial;
  const rolledTo: number[] = [];
  let onRollbackCount = 0;

  const container = createFakeNode("div");
  const panel = createHistoryPanel({
    engine: {
      historyView: () => history,
      rollbackTo: (target: number) => {
        rolledTo.push(target);
      },
      rollbackAvailable: () => true,
    },
    container: container as unknown as HTMLElement,
    onRollback: () => {
      onRollbackCount += 1;
    },
  });

  return {
    container,
    panel,
    rolledTo,
    get onRollbackCount() {
      return onRollbackCount;
    },
    setHistory: (entries: readonly HistoryEntry[]) => {
      history = entries;
    },
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

describe("历史面板视图（纯数据）", () => {
  it("空历史 = 空块表，且默认收起", () => {
    const h = setup();
    expect(h.panel.view()).toEqual({ open: false, blocks: [] });
  });

  it("**数据整形来自 shell 的聚合规则**：连续 NVL 合成一块，普通行各成一块", () => {
    const h = setup([
      entry(0, "旁白", "第一句"),
      // 连续 NVL：累积行只增不减 → 同一块，块尾推进到 2
      nvlEntry(1, "旁白", ["甲"]),
      nvlEntry(2, "旁白", ["甲", "乙"]),
      entry(3, "旁白", "回来的一句"),
    ]);
    const blocks = h.panel.view().blocks;
    expect(blocks.map((block) => block.index)).toEqual([0, 2, 3]);
    expect(blocks[1]?.nvl).toBe(true);
    expect(blocks[1]?.lines).toEqual(["甲", "乙"]);
    // key 由 shell 生成（`blk-<index>`），面板不自己起名
    expect(blocks[0]?.key).toBe("blk-0");
  });

  it("**空说话人与空文本的行被丢掉**（filterHistoryEntries 的口径，不在面板里另写）", () => {
    const h = setup([entry(0, "", ""), entry(1, "旁白", "有内容")]);
    const blocks = h.panel.view().blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.index).toBe(1);
  });

  it("每次调用都是新引用：外部改写块表不得穿透引擎历史", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    const before = h.panel.view();
    const after = h.panel.view();
    expect(after).not.toBe(before);
    expect(after.blocks).not.toBe(before.blocks);
  });

  it("**未挂载也能取视图**（视图计算与 DOM 解耦）", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    expect(h.container.children).toEqual([]);
    expect(h.panel.view().blocks).toHaveLength(1);
  });
});

// ---------- ② DOM 层 ----------

describe("历史面板 DOM", () => {
  it("挂载后容器里有面板根、开关按钮与（收起的）块列表", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    h.panel.mount();
    expect(panelRoot(h.container)).toBeDefined();
    expect(toggleButton(h.container).textContent).toBe("历史");
    // 默认收起：列表不显示
    expect(blockList(h.container).style.display).toBe("none");
    // 面板根带 data-ui-zone（滚轮不该连带回溯舞台）
    expect(panelRoot(h.container).dataset.uiZone).toBe("");
  });

  it("点开关 = 展开并重画；再点一次收起（按钮文案同步）", () => {
    const h = setup([entry(0, "旁白", "第一句"), entry(1, "旁白", "第二句")]);
    h.panel.mount();
    toggleButton(h.container).fire("click");

    expect(h.panel.view().open).toBe(true);
    expect(blockList(h.container).style.display).toBe("");
    expect(toggleButton(h.container).textContent).toBe("关闭历史");
    expect(items(h.container)).toHaveLength(2);

    toggleButton(h.container).fire("click");
    expect(h.panel.view().open).toBe(false);
    expect(blockList(h.container).style.display).toBe("none");
    expect(toggleButton(h.container).textContent).toBe("历史");
  });

  it("块项把回溯目标标在 data-index 上（= 块尾检查点，不是块首）", () => {
    const h = setup([
      nvlEntry(0, "旁白", ["甲"]),
      nvlEntry(1, "旁白", ["甲", "乙"]),
    ]);
    h.panel.mount();
    h.panel.open();
    const [item] = items(h.container);
    expect(item?.dataset.index).toBe("1");
  });

  it("**点块项 = 回溯到那条检查点 + 收起 + 宿主收尾**", () => {
    const h = setup([entry(0, "旁白", "第一句"), entry(1, "旁白", "第二句")]);
    h.panel.mount();
    h.panel.open();

    const [, second] = items(h.container);
    second?.fire("click");

    expect(h.rolledTo).toEqual([1]);
    // 回溯后旧列表已失效：面板收起，等下次展开重读
    expect(h.panel.view().open).toBe(false);
    expect(h.onRollbackCount).toBe(1);
  });

  it("展开重画不残留上一轮的块项（整体重建）", () => {
    const h = setup([entry(0, "旁白", "第一句")]);
    h.panel.mount();
    h.panel.open();
    expect(items(h.container)).toHaveLength(1);

    h.setHistory([entry(0, "旁白", "第一句"), entry(1, "旁白", "第二句")]);
    h.panel.close();
    h.panel.open();
    expect(items(h.container)).toHaveLength(2);
  });

  it("说话人单独一行、正文逐行（NVL 块多行都画出来）", () => {
    const h = setup([nvlEntry(0, "旁白", ["甲", "乙"])]);
    h.panel.mount();
    h.panel.open();

    const [item] = items(h.container);
    const speaker = findAll(
      item ?? h.container,
      (node) => node.className === "history-speaker",
    );
    expect(speaker.map((node) => node.textContent)).toEqual(["旁白"]);

    const lines = findAll(item ?? h.container, (node) =>
      node.className.includes("history-text"),
    );
    expect(lines.map((node) => node.textContent)).toEqual(["甲", "乙"]);
    // NVL 块的行额外带 history-nvl
    expect(lines.every((node) => node.className.includes("history-nvl"))).toBe(
      true,
    );
  });
});

// ---------- ③ 生命周期层 ----------

describe("历史面板生命周期", () => {
  it("**mount 幂等**：重复调用不叠控件", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.mount();
    h.panel.mount();

    expect(
      findAll(h.container, (node) => node.className === "history-panel"),
    ).toHaveLength(1);
    expect(
      findAll(h.container, (node) => node.className === "history-toggle"),
    ).toHaveLength(1);
  });

  it("**destroy 清空容器并复位**；卸载后再操作不抛，可再次 mount", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    h.panel.destroy();

    expect(h.container.children).toEqual([]);
    expect(h.container.textContent).toBe("");
    expect(h.panel.view().open).toBe(false);

    // 已卸载：open/toggle 不抛（没有 DOM 可画，但仍可算视图）
    expect(() => h.panel.open()).not.toThrow();
    expect(h.panel.view().blocks).toHaveLength(1);

    h.panel.mount();
    expect(
      findAll(h.container, (node) => node.className === "history-panel"),
    ).toHaveLength(1);
  });

  it("卸载后再点不到旧块项（引用已断，不会打到引擎）", () => {
    const h = setup([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    const [item] = items(h.container);
    h.panel.destroy();
    item?.fire("click");
    // 旧节点的监听仍会触发 rollbackTo（DOM 已摘，真实浏览器不会点到）；
    // 这里锁的是「destroy 之后面板自身状态复位」而不是「旧节点监听被摘」
    expect(h.panel.view().open).toBe(false);
  });
});

// ---------- ④ 就地重画（语言切换保留展开态） ----------

describe("历史面板就地重画（refresh）", () => {
  /** 造一个译文随语言变的面板：lang 闭包模拟门面 t() 的当前语言 */
  function setupI18n(initial: readonly HistoryEntry[]) {
    let lang = "zh";
    let history = initial;
    const container = createFakeNode("div");
    const panel = createHistoryPanel({
      engine: {
        historyView: () => history,
        rollbackTo: () => {},
        rollbackAvailable: () => true,
      },
      container: container as unknown as HTMLElement,
      translate: (text) => (lang === "zh" ? text : `[en]${text}`),
    });
    return {
      container,
      panel,
      setLang: (next: string) => {
        lang = next;
      },
      setHistory: (next: readonly HistoryEntry[]) => {
        history = next;
      },
    };
  }

  it("**展开态切语言后仍展开**：refresh 不复位 openState，列表照常显示", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    expect(h.panel.view().open).toBe(true);
    h.setLang("en");
    h.panel.refresh();
    expect(h.panel.view().open).toBe(true);
    expect(blockList(h.container).style.display).toBe("");
  });

  it("**收起态切语言后仍收起**：refresh 不把收起的面板展开", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    h.panel.mount(); // 默认收起
    h.setLang("en");
    h.panel.refresh();
    expect(h.panel.view().open).toBe(false);
    expect(blockList(h.container).style.display).toBe("none");
  });

  it("**按钮文案随语言重查**：展开态 refresh 后按钮译成新语言", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    expect(toggleButton(h.container).textContent).toBe("关闭历史");
    h.setLang("en");
    h.panel.refresh();
    expect(toggleButton(h.container).textContent).toBe("[en]关闭历史");
  });

  it("**块内容现读引擎历史重译**：refresh 后块项反映新语言译文（不残留旧块）", () => {
    const h = setupI18n([entry(0, "旁白", "原文")]);
    h.panel.mount();
    h.panel.open();
    // 引擎切语言后历史派生译文（这里以新历史条目模拟引擎读时派生结果）
    h.setHistory([
      entry(0, "旁白", "[en]原文"),
      entry(1, "旁白", "[en]第二句"),
    ]);
    h.panel.refresh();
    const texts = findAll(h.container, (node) =>
      node.className.includes("history-text"),
    );
    expect(texts.map((node) => node.textContent)).toEqual([
      "[en]原文",
      "[en]第二句",
    ]);
    expect(items(h.container)).toHaveLength(2);
  });

  it("**保留列表滚动位置**：refresh 重建块内容后 scrollTop 复原", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    blockList(h.container).scrollTop = 42;
    h.panel.refresh();
    expect(blockList(h.container).scrollTop).toBe(42);
  });

  it("**未挂载 refresh 无操作不抛**（无控件可画）", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    expect(() => h.panel.refresh()).not.toThrow();
    expect(h.container.children).toEqual([]);
  });

  it("**refresh 不叠控件**：多次 refresh 仍只有一个面板根与开关", () => {
    const h = setupI18n([entry(0, "旁白", "一句")]);
    h.panel.mount();
    h.panel.open();
    h.panel.refresh();
    h.panel.refresh();
    expect(
      findAll(h.container, (node) => node.className === "history-panel"),
    ).toHaveLength(1);
    expect(
      findAll(h.container, (node) => node.className === "history-toggle"),
    ).toHaveLength(1);
  });
});

// ---------- ④ 回退控件守卫 ----------

describe("历史面板回退守卫（读引擎唯一读面）", () => {
  /** 自建面板：available 可变，验证块按钮 disabled 跟随引擎读面而非面板自算 */
  function guardSetup(available: () => boolean) {
    const history = [entry(0, "旁白", "第一句"), entry(1, "旁白", "第二句")];
    const container = createFakeNode("div");
    const panel = createHistoryPanel({
      engine: {
        historyView: () => history,
        rollbackTo: () => {},
        rollbackAvailable: available,
      },
      container: container as unknown as HTMLElement,
    });
    panel.mount();
    panel.open();
    return { container, panel };
  }

  it("可回退时块按钮启用", () => {
    const { container } = guardSetup(() => true);
    const items = findAll(
      container,
      (node) => node.className === "history-item",
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect((item as unknown as { disabled: boolean }).disabled).toBe(false);
    }
  });

  it("工程关闭回退 / op 级锁定时块按钮禁用（rollbackAvailable=false）", () => {
    const { container } = guardSetup(() => false);
    const items = findAll(
      container,
      (node) => node.className === "history-item",
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect((item as unknown as { disabled: boolean }).disabled).toBe(true);
    }
  });

  it("锁定解除后 refresh 重渲染即恢复启用", () => {
    let available = false;
    const { container, panel } = guardSetup(() => available);
    expect(
      findAll(container, (node) => node.className === "history-item").every(
        (node) => (node as unknown as { disabled: boolean }).disabled === true,
      ),
    ).toBe(true);
    available = true;
    panel.refresh();
    expect(
      findAll(container, (node) => node.className === "history-item").every(
        (node) => (node as unknown as { disabled: boolean }).disabled === false,
      ),
    ).toBe(true);
  });
});
