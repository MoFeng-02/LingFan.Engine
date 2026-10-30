/**
 * 列级 `uis` 数据链判据（解析 → 写回 → 往返）。
 *
 * `uis` 是**静态声明**：列告诉宿主「我这一列会用到哪些 UI」，宿主据此预加载。
 * 它不加载任何东西，也不等于 `elements`（元素进 SYS.elements 且有 show/hide/animate，
 * UI 进 SYS.mounts 只有显隐）。既然只是声明，它就必须能完整往返——
 * 丢一次宿主就少预加载一次，症状是界面第一次挂载才出现（闪一下）。
 *
 * 判据口径：
 * ① 声明过就落盘（flow / scene 两种列都要）；
 * ② 写回 → 重开 ⇒ 深等（保存不改变语义）；
 * ③ 空数组与缺省等价：两种文件形态都不写该字段（保持文件干净）；
 * ④ 顺序由数据决定而非书写顺序：乱序重复输入 ⇒ 同一份排序去重结果；
 * ⑤ 非法名字 fail-closed（拼错的名字到不了产物）。
 */
import { describe, expect, it } from "vitest";
import {
  assembleProject,
  MANIFEST_FILE,
  parseStory,
  serializeProject,
} from "@lingfan-engine/core";

/** 单列夹具清单（entry 指向该列 id） */
const MANIFEST_A = { formatVersion: 1, id: "demo", entry: "a" };

/** 一列故事文件的 JSON 文本（`uis` 缺省时不带该键） */
function columnFile(id: string, column: Record<string, unknown>): string {
  return JSON.stringify({
    formatVersion: 1,
    columns: [{ id, kind: "flow", commands: [], ...column }],
  });
}

/** 单列工程：写回后的该列文件文本 */
function writeBackOne(column: Record<string, unknown>): string {
  const files = new Map([["Stories/a.json", columnFile("a", column)]]);
  const loaded = assembleProject(MANIFEST_A, files);
  const product = serializeProject(loaded, MANIFEST_A).files;
  return product.get("Stories/a.json") ?? "";
}

describe("列级 uis · 产物落盘", () => {
  it("flow 列声明 uis ⇒ 写回文本含该字段与全部名字", () => {
    const text = writeBackOne({ uis: ["hub"] });
    expect(text).toContain('"uis"');
    expect(text).toContain('"hub"');
    // 字段位置与 type / font 同段（都在 kind 之后、commands 之前）
    expect(text.indexOf('"uis"')).toBeLessThan(text.indexOf('"commands"'));
  });

  it("scene 列声明 uis ⇒ 同样落盘（kind 与 uis 正交）", () => {
    const files = new Map([
      [
        "Stories/a.json",
        JSON.stringify({
          formatVersion: 1,
          columns: [
            {
              id: "a",
              kind: "scene",
              type: "ui",
              uis: ["hub"],
              elements: [],
              commands: [],
            },
          ],
        }),
      ],
    ]);
    const product = serializeProject(
      assembleProject(MANIFEST_A, files),
      MANIFEST_A,
    ).files;
    expect(product.get("Stories/a.json")).toContain('"uis"');
  });
});

describe("列级 uis · 往返稳定", () => {
  it("写回 → 重开 ⇒ 故事深等（JSON 形态往返幂等）", () => {
    const files = new Map([
      ["Stories/a.json", columnFile("a", { uis: ["hub", "map"] })],
    ]);
    const first = assembleProject(MANIFEST_A, files);
    const product = serializeProject(first, MANIFEST_A);
    const storyFiles = new Map(
      [...product.files].filter(([path]) => path !== MANIFEST_FILE),
    );
    expect(assembleProject(MANIFEST_A, storyFiles)).toEqual(first);
    // 再保存一次零差量（写回本身也幂等）
    expect(
      serializeProject(first, MANIFEST_A).files.get("Stories/a.json"),
    ).toBe(product.files.get("Stories/a.json"));
  });

  it("文本 → 解析 ⇒ 列上拿到同一份名字", () => {
    const story = parseStory({
      formatVersion: 1,
      columns: [{ id: "a", kind: "flow", uis: ["hub", "map"], commands: [] }],
    });
    expect(story.columns[0]?.uis).toEqual(["hub", "map"]);
  });
});

describe("列级 uis · 空与缺省等价", () => {
  it("`uis: []` ⇒ 单列形态不写该字段", () => {
    expect(writeBackOne({ uis: [] })).not.toContain('"uis"');
  });

  it("`uis: []` ⇒ 多列形态也不写该字段（两种形态字段集一致）", () => {
    // 同来源文件承载两列 ⇒ 写回走多列形态
    const files = new Map([
      [
        "Stories/a.json",
        JSON.stringify({
          formatVersion: 1,
          columns: [
            { id: "a", kind: "flow", uis: [], commands: [] },
            { id: "b", kind: "flow", uis: [], commands: [] },
          ],
        }),
      ],
    ]);
    const product = serializeProject(
      assembleProject(MANIFEST_A, files),
      MANIFEST_A,
    ).files;
    expect(product.get("Stories/a.json")).not.toContain('"uis"');
  });

  it("缺省声明 ⇒ 不写该字段（与空数组同一条规则）", () => {
    expect(writeBackOne({})).not.toContain('"uis"');
  });
});

describe("列级 uis · 顺序确定", () => {
  it("乱序且重复的输入 ⇒ 同一份码点序去重结果", () => {
    // 单列写回形态 = 单列文件（字段直接挂根，不套 `columns`）
    const parsed = JSON.parse(writeBackOne({ uis: ["map", "hub", "map"] })) as {
      uis?: string[];
    };
    expect(parsed.uis).toEqual(["hub", "map"]);
  });

  it("两种书写顺序产出**逐字节相同**的文件（顺序不来自书写）", () => {
    const forward = writeBackOne({ uis: ["hub", "map"] });
    const backward = writeBackOne({ uis: ["map", "hub"] });
    expect(forward).toBe(backward);
  });
});

describe("列级 uis · 非法名字 fail-closed", () => {
  it("非字符串数组 ⇒ 整次拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "flow", uis: "hub", commands: [] }],
      }),
    ).toThrow(/uis 必须为字符串数组/);
  });

  it("元素不是合法 UI 名 ⇒ 拒绝并指出下标与收到值", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "flow", uis: ["Hub"], commands: [] }],
      }),
    ).toThrow(/uis\[0\] 不是合法 UI 名：收到 "Hub"/);
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "flow", uis: ["hub/x"], commands: [] }],
      }),
    ).toThrow(/不是合法 UI 名/);
  });
});
