/**
 * 元素 op 的文本投影测试。
 *
 * 测试要点五类齐备：**往返互锁 / 拟态用户旅程 / 故意错误 / 边界 / 回归**。
 */
import { describe, expect, it } from "vitest";
import {
  TextFormatError,
  generateText,
  parseStory,
  parseTextStory,
  projectText,
  type Story,
} from "@lingfan/engine";

function flowStory(...commands: Record<string, unknown>[]): Story {
  return parseStory({
    formatVersion: 1,
    id: "d",
    columns: [{ id: "a", kind: "flow", commands }],
  });
}

/** 12 个元素系统 op 的 canonical 负载（与编辑器 CANONICAL 语料同形） */
const CANONICAL_OPS: Array<Record<string, unknown>> = [
  {
    op: "show",
    target: "Images/hero.png",
    x: 40,
    y: "12%",
    id: "hero",
    name: "cast",
    background: false,
  },
  { op: "hide", target: "hero" },
  { op: "background", resource: "Images/bg.png" },
  { op: "bg_switch", resource: "Images/bg2.png" },
  { op: "zindex", target: "hero", value: 42 },
  { op: "style", target: "hero", props: { opacity: 0.5, color: "#ffffff" } },
  { op: "window", mode: "hide" },
  {
    op: "animate",
    target: "hero",
    property: "opacity",
    value: 1,
    duration: 0.5,
    easing: "EaseOutQuad",
  },
  {
    op: "animate_block",
    target: "hero",
    x: 10,
    y: 20,
    opacity: 1,
    rotation: 0,
    scale: 1,
    duration: 0.6,
    easing: "EaseInQuad",
  },
  { op: "transition", type: "fade", duration: 0.5 },
  { op: "shake", intensity: 8, duration: 0.4 },
  { op: "text_typewriter", enabled: true, speed: 30 },
];

describe("往返等价：元素 op 的 JSON → 文本 → JSON", () => {
  for (const cmd of CANONICAL_OPS) {
    it(`${cmd.op} 往返保真`, () => {
      const text = generateText(flowStory(cmd));
      const back = parseTextStory(text, "rt.story");
      expect(back.columns[0]?.commands).toEqual([cmd]);
    });
  }
});

describe("拟态用户旅程：写一段含 scene 列与元素操作的文本", () => {
  const source = [
    "label intro:",
    '  say "开场"',
    "scene stage",
    '  image "Images/bg.png" id=bg x=0 y=0 width=100% height=100%',
    '  text "标题" id=title x=5% width=90% size=34',
    "  panel id=box direction=vertical spacing=12",
    '    button "开始" nav=intro',
    '  background "Images/bg2.png"',
    '  show "Images/hero.png" id=hero x=40 y=120 name=cast',
    '  animate "hero" property=opacity value=0.9 duration=1',
    "  window auto",
    '  say "进入舞台"',
  ].join("\n");

  it("解析出 flow + scene 两列；元素与 entry 分组正确（含嵌套）", () => {
    const story = parseTextStory(source, "journey.story");
    expect(story.columns.map((c) => `${c.kind}:${c.id}`)).toEqual([
      "flow:intro",
      "scene:stage",
    ]);
    const stage = story.columns[1]!;
    expect(stage.elements?.map((e) => e.type)).toEqual([
      "image",
      "text",
      "panel",
    ]);
    expect(stage.elements?.[1]).toMatchObject({
      id: "title",
      x: "5%",
      size: 34,
    });
    expect(stage.elements?.[2]?.children?.[0]).toMatchObject({
      type: "button",
      text: "开始",
      nav: "intro",
    });
    expect(stage.entry?.map((c) => c.op)).toEqual([
      "background",
      "show",
      "animate",
      "window",
      "say",
    ]);
  });

  it("再投影回文本：关键行复现，二次往返稳定", () => {
    const story = parseTextStory(source, "journey.story");
    const again = generateText(story);
    expect(again).toContain("scene stage");
    expect(again).toContain(
      'animate "hero" property=opacity value=0.9 duration=1',
    );
    expect(again).toContain('button "开始" nav=intro');
    const twice = parseTextStory(again, "journey.story");
    expect(twice.columns).toEqual(story.columns);
  });
});

describe("故意错误：参数错 / 缺必填 → 整次拒绝并带行列定位", () => {
  const cases: Array<[string, RegExp]> = [
    ["  shake nope=1", /shake 未知参数/],
    ["  background bg.png", /需要资源路径字符串/],
    ['  zindex "x" value=abc', /zindex\.value 必须为数字/],
    ["  window nope", /window 需要 auto\|show\|hide/],
    ["  text_typewriter", /至少需要 enabled 或 speed/],
    ['  animate "x" property=p', /animate 需要 value=数字/],
    ['  animate "x" value=1', /animate 需要 property/],
    ['  animate_block "x" duration=1', /至少需要一个属性/],
    ["  hide", /hide 需要目标字符串/],
    ['  show "a.png" nope=1', /show 未知参数/],
    ["  transition fade", /transition 需要效果名字符串/],
    ["  bg_switch", /需要资源路径字符串/],
  ];

  for (const [line, pattern] of cases) {
    it(`拒绝并定位：${line.trim()}`, () => {
      let error: unknown;
      try {
        parseTextStory(`label a:\n${line}`, "bad.story");
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(TextFormatError);
      const issues = (error as TextFormatError).issues;
      expect(issues.join("\n")).toMatch(pattern);
      expect(issues[0]).toContain("bad.story:2"); // 行列定位
    });
  }
});

describe("边界", () => {
  it("shake 无参数合法（执行器给缺省）", () => {
    const back = parseTextStory("label a:\n  shake", "b.story");
    expect(back.columns[0]?.commands).toEqual([{ op: "shake" }]);
  });

  it("text_typewriter 只给 speed；style props 值含空格与引号", () => {
    const back = parseTextStory(
      [
        "label a:",
        "  text_typewriter speed=24",
        '  style "t" props={"color": "#ff0000", "font": "serif"}',
      ].join("\n"),
      "b.story",
    );
    expect(back.columns[0]?.commands).toEqual([
      { op: "text_typewriter", speed: 24 },
      { op: "style", target: "t", props: { color: "#ff0000", font: "serif" } },
    ]);
  });

  it("show 的 x 支持 CSS 百分比串；animate_block 单属性合法", () => {
    const back = parseTextStory(
      ['label a:', '  show "a.png" x=50%', '  animate_block "t" opacity=0'].join(
        "\n",
      ),
      "b.story",
    );
    expect(back.columns[0]?.commands).toEqual([
      { op: "show", target: "a.png", x: "50%" },
      { op: "animate_block", target: "t", opacity: 0 },
    ]);
  });

  it("text_typewriter enabled=false 不被丢成 undefined", () => {
    const back = parseTextStory(
      "label a:\n  text_typewriter enabled=false",
      "b.story",
    );
    expect(back.columns[0]?.commands).toEqual([
      { op: "text_typewriter", enabled: false },
    ]);
  });
});

describe("回归：同名冲突按语句优先（与既有实现一致）", () => {
  it("background / video / window 在文本里解析为 op，而非元素行", () => {
    const back = parseTextStory(
      [
        "label a:",
        '  background "Images/bg.png"',
        '  video "Video/op.mp4"',
        "  window auto",
      ].join("\n"),
      "b.story",
    );
    expect(back.columns[0]?.commands?.map((c) => c.op)).toEqual([
      "background",
      "video",
      "window",
    ]);
  });

  it("scene 列内裸写的同名类型按 op；无冲突类型走元素行（显式前缀见下一 describe）", () => {
    const back = parseTextStory(
      [
        "scene s",
        '  background "Images/bg.png"',
        '  text "标题"',
        '  say "hi"',
      ].join("\n"),
      "b.story",
    );
    const col = back.columns[0]!;
    expect(col.kind).toBe("scene");
    expect(col.elements?.map((e) => e.type)).toEqual(["text"]);
    expect(col.entry?.map((c) => c.op)).toEqual(["background", "say"]);
  });
});

describe("同名冲突类型的显式 element 前缀", () => {
  function sceneStory(): Story {
    return parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [
            { type: "background", source: "Images/bg.png", x: 10 },
            { type: "text", text: "标题" },
          ],
        },
      ],
    });
  }

  it("投影器对冲突类型加 element 前缀，非冲突类型照旧裸写；无 issues", () => {
    const projection = projectText(sceneStory());
    expect(projection.issues).toEqual([]);
    expect(projection.text).toContain('element background "Images/bg.png"');
    expect(projection.text).toContain('text "标题"');
  });

  it("回读后冲突类型仍是元素（不是同名 op）——文本 ↔ JSON 往返精确", () => {
    const story = sceneStory();
    const back = parseTextStory(generateText(story), "rt.story");
    expect(back.columns[0]?.elements).toEqual(story.columns[0]?.elements);
    expect(back.columns[0]?.entry ?? []).toEqual([]);
  });

  it("同一文本里 op 与同名元素可共存（两侧都可达）", () => {
    const back = parseTextStory(
      [
        "scene s",
        '  element background "Images/bg.png" id=bg',
        '  background "Images/op.png"',
      ].join("\n"),
      "b.story",
    );
    const col = back.columns[0]!;
    expect(col.elements?.map((e) => e.type)).toEqual(["background"]);
    expect(col.elements?.[0]?.id).toBe("bg");
    expect(col.entry?.map((c) => c.op)).toEqual(["background"]);
  });

  it("element 前缀对非冲突类型同样可用（显式写法等价）", () => {
    const back = parseTextStory(
      'scene s\n  element text "标题" id=t',
      "b.story",
    );
    expect(back.columns[0]?.elements).toEqual([
      { type: "text", text: "标题", id: "t" },
    ]);
  });

  it("嵌套子元素同样加前缀（边界）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [
            { type: "panel", children: [{ type: "window", x: 5 }] },
          ],
        },
      ],
    });
    const text = generateText(story);
    expect(text).toContain("    element window x=5");
    // 只比元素树（parseStory 会给列塞 `commands: undefined` 归一化键，非文本往返差异）
    expect(parseTextStory(text, "rt.story").columns[0]?.elements).toEqual(
      story.columns[0]?.elements,
    );
  });

  it("element 前缀后不是元素类型 → 整次拒绝并带行列定位（故意错误）", () => {
    let error: unknown;
    try {
      parseTextStory("scene s\n  element teleporter", "bad.story");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TextFormatError);
    const issues = (error as TextFormatError).issues;
    expect(issues.join("\n")).toContain("element 前缀后不是已知元素类型");
    expect(issues[0]).toContain("bad.story:2");
  });

  it("flow 列体里 element 前缀不是元素语法（边界：元素只属 scene 列）", () => {
    expect(() =>
      parseTextStory('label a:\n  element text "x"', "bad.story"),
    ).toThrow(TextFormatError);
  });
});
