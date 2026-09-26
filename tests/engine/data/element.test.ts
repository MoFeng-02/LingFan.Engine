/**
 * 08 §二.1 元素系统（数据层）测试。
 * 锚点: element-unknown-type-rejected / element-unknown-attr-rejected /
 *       element-children-nesting / element-z-three-levels / element-address-id-over-name
 *
 * 白盒：`validateElement` / `loadElements` / `findElements` 为引擎内部纯函数
 * （未列入包公共出口），按测试纪律走相对深引。
 */
import { describe, expect, it } from "vitest";
import { StoryFormatError, parseStory } from "@lingfan/engine";
import {
  findElements,
  loadElements,
  validateElement,
} from "../../../packages/engine/src/data/element";

function issuesOf(node: unknown): string[] {
  const issues: string[] = [];
  validateElement(node, "el", issues);
  return issues;
}

describe("validateElement（F5 fail-closed）", () => {
  it("36 类型内且属性合法 → 通过", () => {
    expect(
      issuesOf({ type: "text", text: "甲", x: "50%", color: "#fff" }),
    ).toEqual([]);
  });

  it("未知类型 → 拒绝（锚点: element-unknown-type-rejected）", () => {
    const issues = issuesOf({ type: "teleporter" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("36 种元素类型");
  });

  it("未知属性 → 拒绝（锚点: element-unknown-attr-rejected）", () => {
    const issues = issuesOf({ type: "image", source: "a.png", hack: 1 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("hack");
  });

  it("非对象 / 缺 type → 拒绝", () => {
    expect(issuesOf(null)).toEqual(["el 必须为对象"]);
    expect(issuesOf({})[0]).toContain("36 种元素类型");
  });

  it("id / name 合法；空串拒绝", () => {
    expect(issuesOf({ type: "text", id: "a", name: "b" })).toEqual([]);
    expect(issuesOf({ type: "text", id: "" })[0]).toContain(
      "id 必须为非空字符串",
    );
  });

  it("children 仅容器可带，且递归校验（锚点: element-children-nesting）", () => {
    expect(issuesOf({ type: "text", children: [] })[0]).toContain(
      "仅容器类型可带",
    );
    expect(
      issuesOf({ type: "panel", children: [{ type: "text", text: "甲" }] }),
    ).toEqual([]);
    expect(issuesOf({ type: "panel", children: [{ type: "nope" }] })[0]).toContain(
      "children[0]",
    );
  });
});

describe("loadElements（装载与派生）", () => {
  it("id 缺省派生 `列id#序号`，显式 id 优先", () => {
    const els = loadElements(
      [{ type: "text", text: "甲" }, { type: "text", id: "named" }],
      "start",
    );
    expect(els[0]?.id).toBe("start#0");
    expect(els[1]?.id).toBe("named");
  });

  it("z 三级：zindex > order > 到达序（锚点: element-z-three-levels）", () => {
    const els = loadElements(
      [
        { type: "text" },
        { type: "text", order: 7 },
        { type: "text", order: 7, zindex: 42 },
      ],
      "start",
    );
    expect(els[0]?.z).toBe(0);
    expect(els[1]?.z).toBe(7);
    expect(els[2]?.z).toBe(42);
  });

  it("props 不含结构字段；children 递归装载（锚点: element-children-nesting）", () => {
    const els = loadElements(
      [
        {
          type: "panel",
          id: "p",
          name: "grp",
          children: [{ type: "text", text: "甲", zindex: 3 }],
        },
      ],
      "start",
    );
    const panel = els[0]!;
    expect(panel.props).toEqual({});
    expect(panel.name).toBe("grp");
    expect(panel.children[0]?.id).toBe("p#0");
    expect(panel.children[0]?.z).toBe(3);
    expect(panel.children[0]?.props).toEqual({ text: "甲", zindex: 3 });
  });
});

describe("findElements（寻址：id 精确 > name 批量）", () => {
  const tree = loadElements(
    [
      { type: "button", id: "start", text: "开始" },
      { type: "button", name: "menu", text: "甲" },
      { type: "button", name: "menu", text: "乙" },
      { type: "panel", children: [{ type: "text", name: "menu", text: "丙" }] },
    ],
    "start",
  );

  it("id 精确命中优先于 name 分组（锚点: element-address-id-over-name）", () => {
    const hit = findElements(tree, "start");
    expect(hit).toHaveLength(1);
    expect(hit[0]?.id).toBe("start");
  });

  it("name 批量命中（含容器内子元素）", () => {
    expect(findElements(tree, "menu")).toHaveLength(3);
  });

  it("未命中 → 空数组（调用方 fail-closed，不静默）", () => {
    expect(findElements(tree, "ghost")).toEqual([]);
  });
});

describe("parseStory（元素声明接入解析链）", () => {
  it("scene 列含合法元素 → 解析通过", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "start",
          kind: "scene",
          elements: [{ type: "image", source: "Images/bg.png" }],
          entry: [{ op: "say", text: "甲" }],
        },
      ],
    });
    expect(story.columns[0]?.elements).toHaveLength(1);
  });

  it("未知元素属性 → 整次拒绝（F5）", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "start",
            kind: "scene",
            elements: [{ type: "image", nope: 1 }],
          },
        ],
      }),
    ).toThrow(StoryFormatError);
  });

  it("同列元素 id 重复 → 整次拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "start",
            kind: "scene",
            elements: [
              { type: "text", id: "dup" },
              { type: "text", id: "dup" },
            ],
          },
        ],
      }),
    ).toThrow(/id 重复/);
  });
});
