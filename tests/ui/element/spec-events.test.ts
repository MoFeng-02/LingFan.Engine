/**
 * 事件名与事件载荷：描述树的事件词表（平台中立）与 Web 物化器的载荷提取。
 *
 * 两层把关：
 * - **编译期**（`pnpm typecheck` / vue-tsc 把关）：事件名是闭合联合，拼错即红；
 *   既有 handler（不接参数）必须仍然合法——`@ts-expect-error` 停止报红即视为指令失效。
 * - **运行期**（vitest）：物化器把控件当前值交给 handler，非标量不穿透。
 *
 * node 环境无 document：用最小 DOM 替身（只覆盖物化器用到的表面积），
 * 与 `spec-materialize.test.ts` 同一手法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  materialize,
  type RenderEvent,
  type RenderEventName,
  type RenderPropValue,
} from "@lingfan-engine/ui";

interface FakeEvent {
  target: unknown;
  stopped: boolean;
  stopPropagation(): void;
}

type FakeListener = (event: FakeEvent) => void;

interface FakeNode {
  tagName: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  children: FakeNode[];
  dataset: Record<string, string>;
  appendChild(child: FakeNode): void;
  addEventListener(type: string, handler: FakeListener): void;
  /** 测试用：触发某事件的监听器（`target` 缺省为节点自身，与「事件源自本节点」一致） */
  fire(type: string, target?: unknown): FakeEvent;
}

function createFake(tag: string): FakeNode {
  const listeners = new Map<string, FakeListener[]>();
  const node = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {} as Record<string, string>,
    textContent: "",
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
    fire(type: string, target?: unknown): FakeEvent {
      const event: FakeEvent = {
        target: target === undefined ? node : target,
        stopped: false,
        stopPropagation(): void {
          event.stopped = true;
        },
      };
      for (const handler of listeners.get(type) ?? []) handler(event);
      return event;
    },
  } as unknown as FakeNode;
  Object.defineProperty(node, "innerHTML", {
    get: () => "",
    set: () => {
      node.children.length = 0;
    },
  });
  return node;
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFake(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 物化结果按替身看（替身另有 `fire` 这个测试专用面） */
function asNode(spec: Parameters<typeof materialize>[0]): FakeNode {
  return materialize(spec) as unknown as FakeNode;
}

describe("RenderEvent 事件词表（编译期 + 运行期）", () => {
  it("五个事件名齐备，联合闭合（拼错由 vue-tsc 拒绝）", () => {
    const names: RenderEventName[] = [
      "click",
      "mouseenter",
      "mouseleave",
      "input",
      "change",
    ];
    expect(names).toHaveLength(5);

    // @ts-expect-error 未声明的事件名 ⇒ 联合无此成员
    const typo: RenderEventName = "dblclick";
    void typo;

    // @ts-expect-error 事件名在绑定处同样收窄（不是任意字符串）
    const badBinding: RenderEvent = { on: "onchange" };
    void badBinding;
  });

  it("既有 handler（不接参数）零改动即合法：可选载荷参数向后兼容", () => {
    const legacy: RenderEvent = {
      on: "click",
      handler: () => ({ style: { color: "#f00" } }),
    };
    // 物化器按新签名调用时传了载荷，旧 handler 忽略即可，补丁照常返回
    expect(legacy.handler?.("ignored")).toEqual({ style: { color: "#f00" } });

    const received: Array<RenderPropValue | undefined> = [];
    const withPayload: RenderEvent = {
      on: "change",
      handler: (value) => {
        received.push(value);
      },
    };
    withPayload.handler?.("42");
    expect(received).toEqual(["42"]);
  });

  it("`input` 与 `change` 都可绑定（值在变 / 值已定，两个时机都留给渲染器选）", () => {
    const events: RenderEvent[] = [
      { on: "input", handler: () => undefined },
      { on: "change", handler: () => undefined },
    ];
    expect(events.map((event) => event.on)).toEqual(["input", "change"]);
  });
});

describe("物化器：事件载荷", () => {
  it("change 下 handler 收到控件当前值（range 给的是字符串）", () => {
    const received: Array<RenderPropValue | undefined> = [];
    const node = asNode({
      kind: "slider",
      props: { type: "range", min: "0", max: "100", value: "42" },
      events: [
        {
          on: "change",
          handler: (value) => {
            received.push(value);
          },
        },
      ],
    });

    node.fire("change");
    expect(received).toEqual(["42"]);
    expect(typeof received[0]).toBe("string");
  });

  it("click 下 handler 收到 undefined（不带 value 的节点不误传）", () => {
    const received: Array<RenderPropValue | undefined> = [];
    const node = asNode({
      kind: "action",
      props: { type: "button" },
      events: [
        {
          on: "click",
          handler: (value) => {
            received.push(value);
          },
        },
      ],
    });

    node.fire("click");
    expect(received).toEqual([undefined]);
  });

  it("target 无 value 字段时不抛（mouseenter）", () => {
    const received: Array<RenderPropValue | undefined> = [];
    const node = asNode({
      kind: "box",
      events: [
        {
          on: "mouseenter",
          handler: (value) => {
            received.push(value);
          },
        },
      ],
    });

    expect(() => node.fire("mouseenter")).not.toThrow();
    expect(received).toEqual([undefined]);
  });

  it("载荷为非标量（对象 / 数组）时返回 undefined，不穿透", () => {
    const received: Array<RenderPropValue | undefined> = [];
    const node = asNode({
      kind: "box",
      events: [
        {
          on: "change",
          handler: (value) => {
            received.push(value);
          },
        },
      ],
    });

    const carrier = node as unknown as { value: unknown };
    carrier.value = { nested: true };
    node.fire("change");
    carrier.value = ["a"];
    node.fire("change");

    expect(received).toEqual([undefined, undefined]);
  });

  it("target 为 null 或非对象时也不抛", () => {
    const received: Array<RenderPropValue | undefined> = [];
    const node = asNode({
      kind: "box",
      events: [
        {
          on: "change",
          handler: (value) => {
            received.push(value);
          },
        },
      ],
    });

    node.fire("change", null);
    node.fire("change", 42);
    expect(received).toEqual([undefined, undefined]);
  });

  it("载荷与补丁正交：change 里返回的补丁照常应用到节点", () => {
    const node = asNode({
      kind: "slider",
      style: { color: "#111" },
      props: { type: "range", value: "10" },
      events: [
        {
          on: "change",
          handler: (value) => ({ props: { value: value as string } }),
        },
      ],
    });

    node.fire("change");
    expect(node.style.color).toBe("#111");
    expect(node.fire("change").stopped).toBe(false);
  });
});
