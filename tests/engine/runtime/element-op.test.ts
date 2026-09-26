/**
 * 08 §二.1 元素增删 op 测试（show / hide / background / bg_switch）。
 * 锚点: element-show-append / element-hide-removes / element-background-single / element-op-unknown-field
 *
 * 语义对照老引擎 `ShowHideHandler` / `BgSwitchHandler`（`Services/Core/Handlers/VisualHandlers.cs`、
 * `Dsl2Handlers.cs:177`）；差异：老引擎分场景元素与运行时元素两处，新引擎合并进 `SYS.elements`。
 */
import { describe, expect, it } from "vitest";
import type { ElementInstance, OutboundEvent } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

function makeEngine(entry: object[]): {
  engine: StoryEngine;
  errors: OutboundEvent[];
} {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [{ type: "text", id: "title", text: "标题" }],
          entry,
        },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => errors.push(e));
  return { engine, errors };
}

function elements(engine: StoryEngine): ElementInstance[] {
  const value = engine.get(SYS.elements);
  return Array.isArray(value) ? (value as ElementInstance[]) : [];
}

function ids(engine: StoryEngine): string[] {
  return elements(engine).map((e) => e.id);
}

describe("show（锚点: element-show-append）", () => {
  it("追加 image 元素：source/x/y 入 props，z 取追加序", () => {
    const { engine, errors } = makeEngine([
      { op: "show", target: "Images/hero.png", x: 100, y: 200, id: "hero" },
    ]);
    engine.start();
    expect(ids(engine)).toEqual(["title", "hero"]);
    const hero = elements(engine)[1]!;
    expect(hero.type).toBe("image");
    expect(hero.props).toEqual({ source: "Images/hero.png", x: 100, y: 200 });
    expect(hero.z).toBe(1); // 追加序（背景元素才用 BACKGROUND_Z）
    expect(errors).toHaveLength(0);
    engine.dispose();
  });

  it("id 缺省按追加序派生（确定性：同序重放同 id）", () => {
    const { engine } = makeEngine([{ op: "show", target: "Images/a.png" }]);
    engine.start();
    expect(ids(engine)).toEqual(["title", "show#1"]);
    engine.dispose();
  });

  it("background=true：先清旧背景 → 固定底层序（-1000）", () => {
    const { engine } = makeEngine([
      { op: "background", resource: "Images/first.png" },
      { op: "show", target: "Images/second.png", background: true },
    ]);
    engine.start();
    const list = elements(engine);
    const backgrounds = list.filter((e) => e.type === "background");
    expect(backgrounds).toHaveLength(1); // 不堆积（老引擎 RemoveAll 语义）
    expect(backgrounds[0]?.props.source).toBe("Images/second.png");
    expect(backgrounds[0]?.z).toBe(-1000); // 渲染底层由 z 决定（数组序 ≠ 渲染序）
    engine.dispose();
  });

  it("缺 target → 解析期拒绝；未知字段 → 运行期 fail-closed（双保险）", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          { id: "s", kind: "scene", elements: [], entry: [{ op: "show" }] },
        ],
      }),
    ).toThrow(/必须为非空字符串/);

    const badField = makeEngine([{ op: "show", target: "a.png", nope: 1 }]);
    badField.engine.start();
    expect(
      badField.errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "show-unknown-field",
      ),
    ).toBe(true);
    badField.engine.dispose();
  });
});

describe("hide（锚点: element-hide-removes）", () => {
  it("按 id 移除；按 source 亦可命中；未命中幂等不报错", () => {
    const { engine, errors } = makeEngine([
      { op: "show", target: "Images/a.png", id: "a" },
      { op: "hide", target: "a" },
      { op: "hide", target: "Images/none.png" },
    ]);
    engine.start();
    expect(ids(engine)).toEqual(["title"]);
    expect(errors).toHaveLength(0); // 未命中不算错误（老引擎 RemoveAll 静默）
    engine.dispose();
  });

  it("按 name 批量移除（含容器内子元素）", () => {
    const { engine } = makeEngine([
      { op: "show", target: "Images/a.png", id: "a", name: "grp" },
      { op: "show", target: "Images/b.png", id: "b", name: "grp" },
      { op: "hide", target: "grp" },
    ]);
    engine.start();
    expect(ids(engine)).toEqual(["title"]);
    engine.dispose();
  });
});

describe("background / bg_switch（锚点: element-background-single）", () => {
  it("两者都替换背景且恒只有一个 background", () => {
    const { engine } = makeEngine([
      { op: "background", resource: "Images/one.png" },
      { op: "bg_switch", resource: "Images/two.png" },
    ]);
    engine.start();
    const backgrounds = elements(engine).filter((e) => e.type === "background");
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0]?.props.source).toBe("Images/two.png");
    engine.dispose();
  });
});

describe("回溯与元素表（锚点: element-snapshot-roundtrip）", () => {
  it("show 后回溯 → 元素表随快照还原（增删都是状态）", () => {
    const { engine } = makeEngine([
      { op: "say", text: "一句" },
      { op: "show", target: "Images/a.png", id: "a" },
      { op: "say", text: "二句" },
    ]);
    engine.start(); // 停在「一句」（检查点 1：仅 title）
    engine.advance(); // 推进 → 执行 show → 停在「二句」（检查点 2：title + a）
    expect(ids(engine)).toEqual(["title", "a"]);
    engine.back();
    expect(ids(engine)).toEqual(["title"]);
    engine.dispose();
  });
});

describe("zindex / style / window（元素改造与对话框显隐）", () => {
  it("zindex：改目标层级；未命中 fail-closed（锚点: element-zindex-target）", () => {
    const { engine, errors } = makeEngine([
      { op: "show", target: "Images/a.png", id: "a" },
      { op: "zindex", target: "a", value: 42 },
    ]);
    engine.start();
    expect(elements(engine).find((e) => e.id === "a")?.z).toBe(42);
    expect(errors).toHaveLength(0);
    engine.dispose();

    const miss = makeEngine([{ op: "zindex", target: "ghost", value: 1 }]);
    miss.engine.start();
    expect(
      miss.errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "zindex-target-not-found",
      ),
    ).toBe(true);
    miss.engine.dispose();
  });

  it("style：属性合并而不是替换；未知属性 fail-closed（F5 同口径）", () => {
    const { engine, errors } = makeEngine([
      { op: "show", target: "Images/a.png", id: "a" },
      { op: "style", target: "a", props: { opacity: 0.5, color: "#f00" } },
    ]);
    engine.start();
    const a = elements(engine).find((e) => e.id === "a");
    expect(a?.props.opacity).toBe(0.5);
    expect(a?.props.color).toBe("#f00");
    expect(a?.props.source).toBe("Images/a.png"); // 原有属性保留
    expect(errors).toHaveLength(0);
    engine.dispose();

    const bad = makeEngine([
      { op: "style", target: "title", props: { nope: 1 } },
    ]);
    bad.engine.start();
    expect(
      bad.errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "style-unknown-attr",
      ),
    ).toBe(true);
    bad.engine.dispose();
  });

  it("window：三态写入 SYS.dialogVisible；非法 mode 解析期拒绝", () => {
    const { engine, errors } = makeEngine([{ op: "window", mode: "hide" }]);
    engine.start();
    expect(engine.get(SYS.dialogVisible)).toBe("hide");
    expect(errors).toHaveLength(0);
    engine.dispose();

    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "scene",
            elements: [],
            entry: [{ op: "window", mode: "nope" }],
          },
        ],
      }),
    ).toThrow(/mode/);
  });
});
