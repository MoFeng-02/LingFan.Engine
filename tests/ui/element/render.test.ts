/**
 * 元素渲染（UI 层）测试。
 *
 * node 环境无 document：本层渲染器已只产出 `RenderSpec`，故这里用一个假渲染端口
 * 收描述树即可——渲染器的产物与平台无关，DOM 物化另有 `spec-materialize.test.ts` 覆盖。
 */
import { describe, expect, it, vi } from "vitest";
import { ELEMENT_TYPES, type ElementInstance } from "@lingfan-engine/core";
import {
  createElementRegistry,
  elementStyle,
  registerBuiltinElementRenderers,
  renderElementTree,
  type RenderPort,
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

function instance(id: string, type: string, z = 0): ElementInstance {
  return { id, type, props: {}, z, children: [] };
}

function builtinRegistry() {
  const registry = createElementRegistry();
  registerBuiltinElementRenderers(registry);
  return registry;
}

describe("ElementRegistry（fail-closed 注册制）", () => {
  it("未注册类型 → undefined（不伪造默认渲染）", () => {
    const registry = createElementRegistry();
    expect(registry.has("panel")).toBe(false);
    expect(registry.get("panel")).toBeUndefined();
  });

  it("内建注册覆盖首期类型；同类型再注册 = 覆盖（宿主扩展语义）", () => {
    const registry = builtinRegistry();
    expect(registry.has("text")).toBe(true);
    expect(registry.has("button")).toBe(true);
    expect(registry.has("image")).toBe(true);
    const custom = (): RenderSpec => ({ kind: "box" });
    registry.register("text", custom);
    expect(registry.get("text")).toBe(custom);
  });

  it("36 类型全覆盖：ELEMENT_TYPES 每一种都有内建渲染器（防漏注册）", () => {
    const registry = builtinRegistry();
    expect(ELEMENT_TYPES.filter((t) => !registry.has(t))).toEqual([]);
    expect(registry.types()).toHaveLength(ELEMENT_TYPES.length);
  });
});

describe("elementStyle（属性 → CSS）", () => {
  it("x/y → absolute + left/top（百分比原样交给 CSS，对齐既有实现百分比定位语义）", () => {
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
  it("未知类型：不产出描述树且上报（fail-closed）", () => {
    const { port, specs } = createFakePort();
    const unknown: string[] = [];
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [instance("t1", "teleporter"), instance("x1", "text")],
      onUnknownType: (type) => unknown.push(type),
    });
    expect(unknown).toEqual(["teleporter"]);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.className).toContain("lf-text");
  });

  it("已注册类型：渲染并把舞台内叠放序写入 zIndex、元素 id 写入定位锚（两级叠放）", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [instance("x1", "text", 7)],
    });
    expect(specs[0]?.style?.zIndex).toBe("7");
    expect(specs[0]?.id).toBe("x1");
  });

  it("容器渲染 children；重复调用整体重建（幂等）", () => {
    const { port, specs } = createFakePort();
    const registry = builtinRegistry();
    const panel: ElementInstance = {
      id: "p",
      type: "panel",
      props: { direction: "horizontal" },
      z: 0,
      children: [instance("c1", "text")],
    };
    renderElementTree({ registry, port, elements: [panel] });
    expect(specs).toHaveLength(1);
    expect(specs[0]?.className).toContain("lf-panel");
    expect(specs[0]?.style?.display).toBe("flex");
    expect(specs[0]?.style?.flexDirection).toBe("row");
    expect(specs[0]?.children).toHaveLength(1);

    renderElementTree({ registry, port, elements: [] });
    expect(specs).toHaveLength(0);
  });
});

describe("全量类型渲染（36 类落地语义）", () => {
  function render(
    elements: ElementInstance[],
    options: { resolveResource?: (path: string) => string | undefined } = {},
  ): RenderSpec[] {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements,
      resolveResource: options.resolveResource,
    });
    return specs;
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
    ])[0]!;
    expect(node.style?.display).toBe("grid");
    expect(node.style?.gridTemplateColumns).toBe("repeat(3, 1fr)");
    const child = node.children?.[0];
    if (child === undefined) throw new Error("grid 容器应带子节点");
    expect(child.style?.gridColumnStart).toBe("2");
    expect(child.style?.gridRowStart).toBe("3");
    expect(child.style?.gridColumnEnd).toBe("span 2");
  });

  it("progressbar / vbar：value 在 [min,max] 内的填充比例（横向 / 纵向）", () => {
    const bar = render([
      {
        id: "b",
        type: "progressbar",
        props: { min: 0, max: 100, value: 40 },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(bar.children?.[0]?.style?.width).toBe("40%");

    const vbar = render([
      {
        id: "v",
        type: "vbar",
        props: { min: 0, max: 10, value: 5 },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(vbar.children?.[0]?.style?.height).toBe("50%");
  });

  it("scroll → overflow:auto；viewport → hidden；scroll_h=false 关闭横轴", () => {
    expect(
      render([{ id: "s", type: "scroll", props: {}, z: 0, children: [] }])[0]
        ?.style?.overflow,
    ).toBe("auto");
    expect(
      render([{ id: "v", type: "viewport", props: {}, z: 0, children: [] }])[0]
        ?.style?.overflow,
    ).toBe("hidden");
    expect(
      render([
        {
          id: "s2",
          type: "scrollviewer",
          props: { scroll_h: false },
          z: 0,
          children: [],
        },
      ])[0]?.style?.overflowX,
    ).toBe("hidden");
  });

  it("slider / checkbox：原生 input 语义（min/max/value/checked）走中立种类", () => {
    const slider = render([
      {
        id: "sl",
        type: "slider",
        props: { min: 2, max: 8, value: 5 },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(slider.kind).toBe("slider");
    expect(slider.props?.type).toBe("range");
    expect(slider.props?.min).toBe("2");
    expect(slider.props?.max).toBe("8");
    expect(slider.props?.value).toBe("5");

    const box = render([
      {
        id: "ck",
        type: "checkbox",
        props: { checked: true },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(box.kind).toBe("checkbox");
    expect(box.props?.type).toBe("checkbox");
    expect(box.props?.checked).toBe(true);
  });

  it("spacer → flex:1；separator → 1px 线（direction=vertical 转竖线）", () => {
    expect(
      render([{ id: "sp", type: "spacer", props: {}, z: 0, children: [] }])[0]
        ?.style?.flex,
    ).toBe("1 1 auto");
    expect(
      render([
        { id: "se", type: "separator", props: {}, z: 0, children: [] },
      ])[0]?.style?.height,
    ).toBe("1px");
    expect(
      render([
        {
          id: "sv",
          type: "separator",
          props: { direction: "vertical" },
          z: 0,
          children: [],
        },
      ])[0]?.style?.width,
    ).toBe("1px");
  });

  it("imagebutton：有可解析 source 时产出图像子节点（CORS 匿名先于 src）", () => {
    const withUrl = render(
      [
        {
          id: "ib",
          type: "imagebutton",
          props: { source: "Images/lingfan.png" },
          z: 0,
          children: [],
        },
      ],
      { resolveResource: () => "blob:lf/1" },
    )[0]!;
    expect(withUrl.kind).toBe("action");
    expect(withUrl.props?.type).toBe("button");
    const image = withUrl.children?.[0];
    if (image === undefined)
      throw new Error("imagebutton 带 URL 时应带图片子节点");
    expect(image.kind).toBe("image");
    expect(image.className).toBe("lf-imagebutton-img");
    // 属性顺序即物化顺序：crossOrigin 必须排在 src 前
    expect(Object.keys(image.props ?? {})).toEqual(["crossOrigin", "src"]);
    expect(image.props?.src).toBe("blob:lf/1");

    const withoutUrl = render([
      {
        id: "ib2",
        type: "imagebutton",
        props: { source: "Images/lingfan.png" },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(withoutUrl.children).toBeUndefined(); // 资源未装配 → 退化为文本
    expect(withoutUrl.text).toBe("Images/lingfan.png");
  });

  it("图像：解析不出时把原文落在 alt 上（不伪造占位）", () => {
    const node = render([
      {
        id: "i",
        type: "image",
        props: { source: "Images/missing.png" },
        z: 0,
        children: [],
      },
    ])[0]!;
    expect(node.kind).toBe("image");
    expect(node.props?.alt).toBe("Images/missing.png");
    expect(node.props?.src).toBeUndefined();
  });
});

describe("视觉态与交互（事件补丁，渲染器不碰节点）", () => {
  /** 从描述树里取某个事件绑定 */
  function eventOf(spec: RenderSpec, on: string) {
    return spec.events?.find((event) => event.on === on);
  }

  it("禁用：改前景色/透明度、不挂点击（与点击正交）", () => {
    const [node] = (() => {
      const { port, specs } = createFakePort();
      renderElementTree({
        registry: builtinRegistry(),
        port,
        elements: [
          {
            id: "b",
            type: "button",
            props: {
              text: "开始",
              disabled: true,
              disabled_color: "#999",
              disabled_opacity: 0.4,
            },
            z: 0,
            children: [],
          },
        ],
      });
      return specs;
    })();
    expect(node?.style?.color).toBe("#999");
    expect(node?.style?.opacity).toBe("0.4");
    expect(node?.props?.disabled).toBe(true);
    expect(eventOf(node!, "click")).toBeUndefined(); // 禁用即不挂任何交互
  });

  it("hover：进入/离开两侧补丁，空闲值取自描述树自身", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [
        {
          id: "b",
          type: "button",
          props: { text: "开始", color: "#111", hover_color: "#f00" },
          z: 0,
          children: [],
        },
      ],
    });
    const node = specs[0]!;
    expect(node.style?.color).toBe("#111");
    expect(eventOf(node, "mouseenter")?.handler?.()).toEqual({
      style: { color: "#f00" },
    });
    expect(eventOf(node, "mouseleave")?.handler?.()).toEqual({
      style: { color: "#111" },
    });
  });

  it("可交互元素：恢复点击并阻止冒泡，点击经 activate 回调交给宿主选路", () => {
    const { port, specs } = createFakePort();
    const activate = vi.fn();
    const element: ElementInstance = {
      id: "b",
      type: "button",
      props: { text: "开始", nav: "chapter2" },
      z: 0,
      children: [],
    };
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [element],
      activate,
    });
    const node = specs[0]!;
    expect(node.style?.pointerEvents).toBe("auto");
    expect(node.style?.cursor).toBe("pointer");
    const click = eventOf(node, "click")!;
    expect(click.stopPropagation).toBe(true);
    click.handler?.();
    expect(activate).toHaveBeenCalledWith(element);
  });

  it("selected：点击切换选中态（补丁在点击时现算）", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [
        {
          id: "b",
          type: "button",
          props: { text: "开始", color: "#111", selected_color: "#0f0" },
          z: 0,
          children: [],
        },
      ],
    });
    const click = eventOf(specs[0]!, "click")!;
    expect(click.handler?.()).toEqual({ style: { color: "#0f0" } });
    expect(click.handler?.()).toEqual({ style: { color: "#111" } });
  });
});
