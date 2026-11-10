/**
 * 媒体填充落到描述树（渲染级）。
 *
 * `image` / `background` / `portrait` 三个类型共用同一个渲染器，所以这里既钉「有没有写」，
 * 也钉「写到了哪一列」：背景写错成 `object-fit`（对 `div` 无效）在源级测试里看着是对的，
 * 到了真机就是「作者写了填充方式、画面不动」。缺省值同样钉住——历史工程不写 `stretch`
 * 时行为会从「无 object-fit」变成 `cover`，那是这批唯一可见的行为变化，不能靠记忆。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ELEMENT_FIT } from "@lingfan-engine/core";
import type { ElementInstance } from "@lingfan-engine/core";
import {
  createElementRegistry,
  registerBuiltinElementRenderers,
  renderElementTree,
  type RenderPort,
  type RenderSpec,
} from "@lingfan-engine/ui";

/** 假渲染端口：只收描述树（本层产物与平台无关） */
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

/** 渲染单个元素，返回它的根描述（资源一律解析成同一个 URL，便于断言） */
function renderOne(element: ElementInstance): RenderSpec {
  const { port, specs } = createFakePort();
  renderElementTree({
    registry: builtinRegistry(),
    port,
    elements: [element],
    resolveResource: () => "blob:lf/1",
  });
  const root = specs[0];
  if (root === undefined) throw new Error("元素应产出根描述");
  return root;
}

function element(
  type: string,
  props: Record<string, unknown> = {},
): ElementInstance {
  return {
    id: "e",
    type,
    props: { source: "Images/pic.png", ...props },
    z: 0,
    children: [],
  };
}

describe("image / portrait（<img> 侧）", () => {
  it("图片元素产出 objectFit", () => {
    const spec = renderOne(element("image", { stretch: "contain" }));
    expect(spec.style?.objectFit).toBe("contain");
    expect(spec.props?.src).toBe("blob:lf/1");
  });

  it("立绘走同一条路：objectFit 按自身 stretch", () => {
    const spec = renderOne(element("portrait", { stretch: "none" }));
    expect(spec.style?.objectFit).toBe("none");
  });

  it("未写 stretch：缺省 cover（历史工程的行为变化点）", () => {
    const spec = renderOne(element("image"));
    expect(spec.style?.objectFit).toBe(
      DEFAULT_ELEMENT_FIT === "cover" ? "cover" : DEFAULT_ELEMENT_FIT,
    );
  });

  it("图片元素不写背景列（分错支就是「写了不生效」）", () => {
    const spec = renderOne(element("image", { stretch: "cover" }));
    expect(spec.style?.backgroundSize).toBeUndefined();
    expect(spec.style?.backgroundImage).toBeUndefined();
  });
});

describe("background（div 背景侧）", () => {
  it("背景元素走 backgroundImage 分支并产出 backgroundSize + position", () => {
    const spec = renderOne(element("background", { stretch: "contain" }));
    expect(spec.style?.backgroundImage).toBe('url("blob:lf/1")');
    expect(spec.style?.backgroundSize).toBe("contain");
    expect(spec.style?.backgroundPosition).toBe("center");
  });

  it("背景元素不写 objectFit（对 div 无效）", () => {
    const spec = renderOne(element("background", { stretch: "fill" }));
    expect(spec.style?.objectFit).toBeUndefined();
    expect(spec.style?.backgroundSize).toBe("100% 100%");
  });

  it("未写 stretch：背景缺省 cover", () => {
    const spec = renderOne(element("background"));
    expect(spec.style?.backgroundSize).toBe("cover");
    expect(spec.style?.backgroundPosition).toBe("center");
  });

  it("资源解析不出：仍给出填充列（框的属性与图能不能取到无关）", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [element("background", { stretch: "none" })],
    });
    const spec = specs[0];
    expect(spec?.style?.backgroundImage).toBeUndefined();
    expect(spec?.style?.backgroundSize).toBe("auto");
  });
});

describe("imagebutton / video", () => {
  it("imagebutton 的图片子节点带 objectFit（形状按钮不吃根节点样式）", () => {
    const spec = renderOne(element("imagebutton", { stretch: "contain" }));
    const image = spec.children?.[0];
    if (image === undefined) throw new Error("imagebutton 应带图片子节点");
    expect(image.style?.objectFit).toBe("contain");
  });

  it("imagebutton 资源解析不出：缺省退化为文本，不产出子节点", () => {
    const { port, specs } = createFakePort();
    renderElementTree({
      registry: builtinRegistry(),
      port,
      elements: [element("imagebutton", { stretch: "contain" })],
    });
    expect(specs[0]?.children).toBeUndefined();
  });

  it("video 占位节点写 objectFit（真实 <video> 由端口另写，词表同源）", () => {
    const spec = renderOne(element("video", { stretch: "fill" }));
    expect(spec.kind).toBe("media");
    expect(spec.style?.objectFit).toBe("fill");
  });

  it("video 未写 stretch：占位节点与端口同取缺省", () => {
    const spec = renderOne(element("video"));
    expect(spec.style?.objectFit).toBe("cover");
  });
});
