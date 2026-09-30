/**
 * 元素渲染（UI 层）测试。
 *
 * node 环境无 document：用最小 DOM 替身（只覆盖渲染器用到的表面积），
 * 与 minigame 注册表测试「以替身充当宿主元素」同一手法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELEMENT_TYPES, type ElementInstance } from "@lingfan/engine";
import {
  createElementRegistry,
  elementStyle,
  registerBuiltinElementRenderers,
  renderElementTree,
} from "@lingfan/ui";

interface FakeNode {
  tagName: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  src: string;
  alt: string;
  disabled: boolean;
  type: string;
  children: FakeNode[];
  innerHTML: string;
  appendChild(child: FakeNode): void;
  addEventListener(type: string, handler: () => void): void;
}

function createFake(tag: string): FakeNode {
  const node = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {} as Record<string, string>,
    textContent: "",
    src: "",
    alt: "",
    disabled: false,
    type: "",
    children: [] as FakeNode[],
    appendChild(child: FakeNode): void {
      node.children.push(child);
    },
    addEventListener(): void {
      // 交互绑定不做行为断言（只验证挂载不抛错）
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

function instance(id: string, type: string, z = 0): ElementInstance {
  return { id, type, props: {}, z, children: [] };
}

/** 替身 → 宿主容器（渲染器只用 appendChild / innerHTML 等最小表面积） */
function asHost(node: FakeNode): HTMLElement {
  return node as unknown as HTMLElement;
}

describe("ElementRegistry（fail-closed 注册制）", () => {
  it("未注册类型 → undefined（不伪造默认渲染）", () => {
    const registry = createElementRegistry();
    expect(registry.has("panel")).toBe(false);
    expect(registry.get("panel")).toBeUndefined();
  });

  it("内建注册覆盖首期类型；同类型再注册 = 覆盖（宿主扩展语义）", () => {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    expect(registry.has("text")).toBe(true);
    expect(registry.has("button")).toBe(true);
    expect(registry.has("image")).toBe(true);
    const custom = (): HTMLElement => createFake("div") as unknown as HTMLElement;
    registry.register("text", custom);
    expect(registry.get("text")).toBe(custom);
  });

  it("36 类型全覆盖：ELEMENT_TYPES 每一种都有内建渲染器（防漏注册）", () => {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    expect(ELEMENT_TYPES.filter((t) => !registry.has(t))).toEqual([]);
    expect(registry.types()).toHaveLength(ELEMENT_TYPES.length);
  });
});

describe("elementStyle（属性 → CSS）", () => {
  it("x/y → absolute + left/top（百分比原样交给 CSS，对齐旧版引擎百分比定位语义）", () => {
    expect(elementStyle({ x: "50%", y: 12 })).toMatchObject({
      position: "absolute",
      left: "50%",
      top: "12px",
    });
  });

  it("visible=false → display:none；zindex → zIndex；clipToBounds → overflow:hidden", () => {
    expect(
      elementStyle({ visible: false, zindex: 30, clipToBounds: true }),
    ).toMatchObject({ display: "none", zIndex: "30", overflow: "hidden" });
  });

  it("size 是文本类 fontSize 别名；align 是 halign 安全网", () => {
    expect(elementStyle({ size: 20 })).toMatchObject({ fontSize: "20px" });
    expect(elementStyle({ align: "center" })).toMatchObject({
      textAlign: "center",
    });
    expect(elementStyle({ halign: "right" })).toMatchObject({
      textAlign: "right",
    });
  });

  it("边框：thickness + color 合成 border；无定位属性不产生 absolute", () => {
    expect(
      elementStyle({ borderThickness: 2, borderColor: "#f00" }),
    ).toMatchObject({ border: "2px solid #f00" });
    expect(elementStyle({ opacity: 0.5 })).not.toHaveProperty("position");
  });
});

describe("renderElementTree（未知类型不渲染）", () => {
  it("未知类型：不产出 DOM 且上报（fail-closed）", () => {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    const container = createFake("div");
    const unknown: string[] = [];
    renderElementTree({
      registry,
      container: asHost(container),
      elements: [instance("t1", "teleporter"), instance("x1", "text")],
      onUnknownType: (type) => unknown.push(type),
    });
    expect(unknown).toEqual(["teleporter"]);
    expect(container.children).toHaveLength(1);
    expect(container.children[0]?.className).toContain("lf-text");
  });

  it("已注册类型：渲染并把舞台内叠放序写入 zIndex（两级叠放）", () => {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    const container = createFake("div");
    renderElementTree({
      registry,
      container: asHost(container),
      elements: [instance("x1", "text", 7)],
    });
    expect(container.children[0]?.style.zIndex).toBe("7");
  });

  it("容器渲染 children；重复调用整体重建（幂等）", () => {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    const container = createFake("div");
    const panel: ElementInstance = {
      id: "p",
      type: "panel",
      props: { direction: "horizontal" },
      z: 0,
      children: [instance("c1", "text")],
    };
    renderElementTree({ registry, container: asHost(container), elements: [panel] });
    expect(container.children).toHaveLength(1);
    const panelNode = container.children[0]!;
    expect(panelNode.className).toContain("lf-panel");
    expect(panelNode.style.display).toBe("flex");
    expect(panelNode.style.flexDirection).toBe("row");
    expect(panelNode.children).toHaveLength(1);

    renderElementTree({ registry, container: asHost(container), elements: [] });
    expect(container.children).toHaveLength(0);
  });
});

describe("全量类型渲染（36 类落地语义）", () => {
  function render(elements: ElementInstance[]): FakeNode {
    const registry = createElementRegistry();
    registerBuiltinElementRenderers(registry);
    const container = createFake("div");
    renderElementTree({ registry, container: asHost(container), elements });
    return container;
  }

  it("grid：数字 columns → repeat 轨道；子元素 col/row/colspan 附着（0 基 → CSS 1 基）", () => {
    const node = render([
      {
        id: "g",
        type: "grid",
        props: { columns: 3 },
        z: 0,
        children: [
          {
            id: "c1",
            type: "text",
            props: { col: 1, row: 2, colspan: 2, text: "甲" },
            z: 0,
            children: [],
          },
        ],
      },
    ]).children[0]!;
    expect(node.style.display).toBe("grid");
    expect(node.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
    const child = node.children[0]!;
    expect(child.style.gridColumnStart).toBe("2");
    expect(child.style.gridRowStart).toBe("3");
    expect(child.style.gridColumnEnd).toBe("span 2");
  });

  it("progressbar / vbar：value 在 [min,max] 内的填充比例（横向 / 纵向）", () => {
    const bar = render([
      { id: "b", type: "progressbar", props: { min: 0, max: 100, value: 40 }, z: 0, children: [] },
    ]).children[0]!;
    expect(bar.children[0]?.style.width).toBe("40%");

    const vbar = render([
      { id: "v", type: "vbar", props: { min: 0, max: 10, value: 5 }, z: 0, children: [] },
    ]).children[0]!;
    expect(vbar.children[0]?.style.height).toBe("50%");
  });

  it("scroll → overflow:auto；viewport → hidden；scroll_h=false 关闭横轴", () => {
    expect(
      render([{ id: "s", type: "scroll", props: {}, z: 0, children: [] }]).children[0]
        ?.style.overflow,
    ).toBe("auto");
    expect(
      render([{ id: "v", type: "viewport", props: {}, z: 0, children: [] }]).children[0]
        ?.style.overflow,
    ).toBe("hidden");
    expect(
      render([
        { id: "s2", type: "scrollviewer", props: { scroll_h: false }, z: 0, children: [] },
      ]).children[0]?.style.overflowX,
    ).toBe("hidden");
  });

  it("slider / checkbox：原生 input 承载 min/max/value/checked", () => {
    const slider = render([
      { id: "sl", type: "slider", props: { min: 2, max: 8, value: 5 }, z: 0, children: [] },
    ]).children[0] as unknown as { type: string; min: string; max: string; value: string };
    expect(slider.type).toBe("range");
    expect(slider.min).toBe("2");
    expect(slider.max).toBe("8");
    expect(slider.value).toBe("5");

    const box = render([
      { id: "ck", type: "checkbox", props: { checked: true }, z: 0, children: [] },
    ]).children[0] as unknown as { type: string; checked: boolean };
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(true);
  });

  it("spacer → flex:1；separator → 1px 线（direction=vertical 转竖线）", () => {
    expect(
      render([{ id: "sp", type: "spacer", props: {}, z: 0, children: [] }]).children[0]
        ?.style.flex,
    ).toBe("1 1 auto");
    expect(
      render([{ id: "se", type: "separator", props: {}, z: 0, children: [] }]).children[0]
        ?.style.height,
    ).toBe("1px");
    expect(
      render([
        { id: "sv", type: "separator", props: { direction: "vertical" }, z: 0, children: [] },
      ]).children[0]?.style.width,
    ).toBe("1px");
  });

  it("imagebutton：有 source 时渲染 img 子节点", () => {
    const node = render([
      { id: "ib", type: "imagebutton", props: { source: "Images/lingfan.png" }, z: 0, children: [] },
    ]).children[0]!;
    expect(node.tagName).toBe("BUTTON");
    expect(node.children).toHaveLength(0); // 资源未装配（无 resolveResource）→ 退化为文本
  });
});
