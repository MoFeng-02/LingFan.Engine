/**
 * DOM 物化测试（`packages/ui/src/dom`）：描述树 → Web 节点。
 *
 * node 环境无 document：用最小 DOM 替身（只覆盖物化器用到的表面积）。
 * 本文件是「DOM 只准出现在 dom/ 目录」这条规则的另一半——中立层的产物在这里才落地。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDomRenderPort,
  materialize,
  type RenderEventPatch,
  type RenderKind,
  type RenderSpec,
} from "@lingfan/ui";

interface FakeEvent {
  stopped: boolean;
  stopPropagation(): void;
}

interface FakeNode {
  tagName: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  children: FakeNode[];
  dataset: Record<string, string>;
  appendChild(child: FakeNode): void;
  addEventListener(type: string, handler: () => void): void;
  /** 测试用：触发某事件的监听器，返回「是否被 stopPropagation」 */
  fire(type: string): FakeEvent;
  /** 测试用：属性写入顺序（验证 crossOrigin 先于 src） */
  writtenKeys: string[];
}

function createFake(tag: string): FakeNode {
  const listeners = new Map<string, (() => void)[]>();
  const writtenKeys: string[] = [];
  const node = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {} as Record<string, string>,
    textContent: "",
    children: [] as FakeNode[],
    dataset: {} as Record<string, string>,
    writtenKeys,
    appendChild(child: FakeNode): void {
      node.children.push(child);
    },
    addEventListener(type: string, handler: () => void): void {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    fire(type: string): FakeEvent {
      const event: FakeEvent = {
        stopped: false,
        stopPropagation(): void {
          event.stopped = true;
        },
      };
      for (const handler of listeners.get(type) ?? []) {
        (handler as unknown as (e: FakeEvent) => void)(event);
      }
      return event;
    },
  } as unknown as FakeNode;
  Object.defineProperty(node, "innerHTML", {
    get: () => "",
    set: () => {
      node.children.length = 0;
    },
  });
  // 属性直赋要记顺序：物化器按 `props` 插入顺序写（crossOrigin 必须先于 src）
  return new Proxy(node, {
    set(target, key, value, receiver): boolean {
      if (typeof key === "string" && key !== "writtenKeys") {
        writtenKeys.push(key);
      }
      return Reflect.set(target, key, value, receiver);
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => createFake(tag),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 中立种类 → Web 标签（与物化器的映射表同表，断言它是契约不是巧合） */
const EXPECTED_TAG: Record<RenderKind, string> = {
  box: "DIV",
  text: "DIV",
  image: "IMG",
  media: "VIDEO",
  input: "INPUT",
  slider: "INPUT",
  checkbox: "INPUT",
  action: "BUTTON",
};

/** 物化结果按替身看（替身另有 `fire` / `writtenKeys` 两个测试专用面） */
function asNode(spec: RenderSpec): FakeNode {
  return materialize(spec) as unknown as FakeNode;
}

describe("materialize（描述树 → 节点）", () => {
  it("每种中立种类落到自己的标签（词表与标签的映射是契约）", () => {
    for (const [kind, tag] of Object.entries(EXPECTED_TAG)) {
      expect(materialize({ kind: kind as RenderKind }).tagName).toBe(tag);
    }
  });

  it("类名 / 样式 / 文本 / 属性 / 定位锚 / 子节点按序落地", () => {
    const node = materialize({
      kind: "box",
      className: "lf-el lf-panel",
      style: { display: "flex", gap: "8px" },
      text: "正文",
      props: { title: "提示" },
      id: "e7",
      children: [{ kind: "text", text: "子" }],
    });
    expect(node.className).toBe("lf-el lf-panel");
    expect(node.style).toMatchObject({ display: "flex", gap: "8px" });
    expect(node.textContent).toBe("正文");
    expect(node.dataset.lfId).toBe("e7");
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.textContent).toBe("子");
  });

  it("props 按插入顺序写入（crossOrigin 先于 src，CORS 匿名才生效）", () => {
    const node = asNode({
      kind: "image",
      props: { crossOrigin: "anonymous", src: "blob:lf/1" },
    });
    expect(node.writtenKeys).toEqual(["crossOrigin", "src"]);
  });

  it("事件：触发时应用补丁；声明 stopPropagation 才阻止冒泡", () => {
    const spec: RenderSpec = {
      kind: "action",
      style: { color: "#111" },
      events: [
        {
          on: "mouseenter",
          handler: (): RenderEventPatch => ({ style: { color: "#f00" } }),
        },
        { on: "click", stopPropagation: true, handler: () => {} },
      ],
    };
    const node = asNode(spec);
    node.fire("mouseenter");
    expect(node.style.color).toBe("#f00");

    expect(node.fire("click").stopped).toBe(true);
  });

  it("无 dataset 的环境跳过定位锚（不因缺能力而抛错）", () => {
    vi.stubGlobal("document", {
      createElement: () =>
        ({ style: {}, children: [] }) as unknown as HTMLElement,
    });
    expect(() => materialize({ kind: "box", id: "e1" })).not.toThrow();
  });
});

describe("createDomRenderPort（宿主渲染根）", () => {
  it("clear 清空根下节点；mount 逐棵挂上（整体重建语义）", () => {
    const root = createFake("div");
    const port = createDomRenderPort(root as unknown as HTMLElement);
    port.mount({ kind: "text", text: "甲" });
    port.mount({ kind: "text", text: "乙" });
    expect(root.children).toHaveLength(2);

    port.clear();
    expect(root.children).toHaveLength(0);
  });

  it("同一根重复取端口不串扰（端口是无状态包装）", () => {
    const root = createFake("div");
    const a = createDomRenderPort(root as unknown as HTMLElement);
    const b = createDomRenderPort(root as unknown as HTMLElement);
    a.mount({ kind: "text", text: "甲" });
    b.clear();
    expect(root.children).toHaveLength(0);
  });
});
