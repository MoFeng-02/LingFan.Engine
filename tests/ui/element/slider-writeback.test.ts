/**
 * 滑块值回写：拖动结果从控件回到宿主的整条链路（渲染器 → 描述树事件 → 宿主回调）。
 *
 * 断言分两层：
 * - **渲染器侧**：`slider` 是否挂了 `change`、`disabled` 是否短路、`change` 的 handler
 *   把字符串转成什么交给宿主。本层不碰 DOM，用假渲染端口收描述树即可。
 * - **端到端**：描述树经 Web 物化器落地后真的触发一次回写，且值落在 `min..max` 内。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElementInstance } from "@lingfan-engine/core";
import {
  createElementRegistry,
  materialize,
  registerBuiltinElementRenderers,
  renderElementTree,
  type RenderEvent,
  type RenderPort,
  type RenderPropValue,
  type RenderSpec,
} from "@lingfan-engine/ui";

/** 假渲染端口：只收描述树（clear = 清空收集，mount = 追加） */
function createFakePort(): { port: RenderPort; specs: RenderSpec[] } {
  const specs: RenderSpec[] = [];
  return {
    specs,
    port: {
      clear(): void {
        specs.length = 0;
      },
      mount(spec: RenderSpec): void {
        specs.push(spec);
      },
    },
  };
}

function builtinRegistry() {
  const registry = createElementRegistry();
  registerBuiltinElementRenderers(registry);
  return registry;
}

function slider(props: Record<string, unknown>, id = "sl"): ElementInstance {
  return { id, type: "slider", props, z: 0, children: [] };
}

/** 渲染一个滑块，返回它的描述树与「宿主收到的回写」 */
function renderSlider(props: Record<string, unknown>): {
  spec: RenderSpec;
  changes: Array<{ id: string; value: number | string | boolean }>;
} {
  const { port, specs } = createFakePort();
  const changes: Array<{ id: string; value: number | string | boolean }> = [];
  renderElementTree({
    registry: builtinRegistry(),
    port,
    elements: [slider(props)],
    onElementValueChange: (element, value) => {
      changes.push({ id: element.id, value });
    },
  });
  const spec = specs[0];
  if (spec === undefined) throw new Error("slider 应产出描述树");
  return { spec, changes };
}

function eventOf(spec: RenderSpec, on: string): RenderEvent | undefined {
  return spec.events?.find((event) => event.on === on);
}

/** 触发描述树上的某个事件（模拟控件给出载荷） */
function fire(
  spec: RenderSpec,
  on: string,
  value?: RenderPropValue,
): ReturnType<NonNullable<RenderEvent["handler"]>> {
  const event = eventOf(spec, on);
  if (event === undefined) throw new Error(`描述树未绑定事件：${on}`);
  return event.handler?.(value);
}

describe("slider 值回写（渲染器侧）", () => {
  it("挂了 change，且 handler 把字符串值转成数字交给宿主", () => {
    const { spec, changes } = renderSlider({ min: 0, max: 100, value: 40 });
    expect(eventOf(spec, "change")).toBeDefined();

    fire(spec, "change", "37");
    expect(changes).toEqual([{ id: "sl", value: 37 }]);
    expect(typeof changes[0]?.value).toBe("number");
  });

  it("回写不改节点：handler 返回 undefined（值由控件自身持有）", () => {
    const { spec } = renderSlider({ min: 0, max: 100, value: 40 });
    expect(fire(spec, "change", "50")).toBeUndefined();
  });

  it("非有限数不触发（空串 / 非数字串 / NaN）", () => {
    const { spec, changes } = renderSlider({ min: 0, max: 100, value: 40 });
    for (const raw of ["", "  ", "abc", String(Number.NaN)]) {
      fire(spec, "change", raw);
    }
    expect(changes).toEqual([]);
  });

  it("未注入回调时拖动不抛（宿主没接回写通道 = 静默）", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [slider({ min: 0, max: 100, value: 40 })],
    });
    const spec = specs[0]!;
    expect(() => fire(spec, "change", "60")).not.toThrow();
  });

  it("禁用态滑块不挂 change（disabled 短路仍然生效）", () => {
    const { spec, changes } = renderSlider({
      min: 0,
      max: 100,
      value: 40,
      disabled: true,
    });
    expect(eventOf(spec, "change")).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("纵向滑块同样挂 change（书写方向不影响回写）", () => {
    const { spec, changes } = renderSlider({
      min: 0,
      max: 10,
      value: 5,
      orientation: "vertical",
    });
    expect(spec.style?.writingMode).toBe("vertical-lr");
    fire(spec, "change", "7");
    expect(changes).toEqual([{ id: "sl", value: 7 }]);
  });
});

interface FakeEvent {
  target: unknown;
  stopPropagation(): void;
}

type FakeListener = (event: FakeEvent) => void;

interface FakeNode {
  tagName: string;
  style: Record<string, string>;
  children: FakeNode[];
  dataset: Record<string, string>;
  appendChild(child: FakeNode): void;
  addEventListener(type: string, handler: FakeListener): void;
  fire(type: string): void;
}

function createFake(tag: string): FakeNode {
  const listeners = new Map<string, FakeListener[]>();
  const node = {
    tagName: tag.toUpperCase(),
    style: {} as Record<string, string>,
    children: [] as FakeNode[],
    dataset: {} as Record<string, string>,
    appendChild(child: FakeNode): void {
      node.children.push(child);
    },
    addEventListener(type: string, handler: FakeListener): void {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire(type: string): void {
      const event: FakeEvent = {
        target: node,
        stopPropagation(): void {},
      };
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  } as unknown as FakeNode;
  return node;
}

describe("slider 值回写（端到端：描述树 → 节点 → 宿主）", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => createFake(tag),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("控件触发 change 后宿主收到一次数字回写，值落在 min..max 内", () => {
    const changes: Array<{ id: string; value: number | string | boolean }> = [];
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [slider({ min: 10, max: 20, value: 10 })],
      onElementValueChange: (element, value) => {
        changes.push({ id: element.id, value });
      },
    });

    const node = materialize(specs[0]!) as unknown as FakeNode;
    // 原生 range 的当前值就是这个字段；物化器原样读它，渲染器负责转数字
    (node as unknown as { value: string }).value = "17";
    node.fire("change");

    expect(changes).toEqual([{ id: "sl", value: 17 }]);
    const value = changes[0]?.value;
    if (typeof value !== "number") throw new Error("回写值应为数字");
    expect(value).toBeGreaterThanOrEqual(10);
    expect(value).toBeLessThanOrEqual(20);
  });

  it("一次 change 只回写一次（不因同时挂 click 而重复）", () => {
    const changes: Array<{ id: string; value: number | string | boolean }> = [];
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [slider({ min: 0, max: 100, value: 0, cmd: "score" })],
      onElementValueChange: (element, value) => {
        changes.push({ id: element.id, value });
      },
    });

    const node = materialize(specs[0]!) as unknown as FakeNode;
    (node as unknown as { value: string }).value = "30";
    node.fire("change");
    expect(changes).toHaveLength(1);
  });
});
