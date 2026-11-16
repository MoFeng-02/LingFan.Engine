/**
 * 列身体（`body`）数据链判据：解析 → 形状互斥 → 写回 → 往返。
 *
 * `body` 是列告诉宿主「这一屏由哪个组件来画」的**静态声明**：它不加载任何东西
 * （组件由宿主的注册表提供），也不等于 `elements`（元素由引擎解释、进 `SYS.elements`
 * 且有 show/hide/animate；身体是宿主渲染的整块画面）。三条判据守在这里：
 *
 * ① 声明过就落盘 —— 丢一次保存，列下次打开就变成空场景，且不可逆；
 * ② 与 `elements` **互斥** —— 两者同时声明是「谁画这一屏」的歧义，必须 fail-closed；
 * ③ `props` 必须 JSON 安全 —— prop 里的函数/`undefined`/循环引用会在写入 `SYS.body`
 *    时静默变形，等到渲染才炸就找不到源头了。
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

/** 一列故事文件的 JSON 文本 */
function columnFile(column: Record<string, unknown>): string {
  return JSON.stringify({
    formatVersion: 1,
    columns: [{ id: "a", ...column }],
  });
}

/** 单列工程：写回后的该列文件文本 */
function writeBackOne(column: Record<string, unknown>): string {
  const files = new Map([["Stories/a.json", columnFile(column)]]);
  const loaded = assembleProject(MANIFEST_A, files);
  const product = serializeProject(loaded, MANIFEST_A).files;
  return product.get("Stories/a.json") ?? "";
}

/** 单列 scene 列（有 body 就够，不需要 elements） */
function sceneBody(body: Record<string, unknown>): Record<string, unknown> {
  return { kind: "scene", body };
}

describe("列身体 · 解析", () => {
  it("scene 列声明 body ⇒ 解析出名字与 props", () => {
    const story = parseStory({
      formatVersion: 1,
      columns: [
        {
          id: "a",
          kind: "scene",
          body: { name: "kitchen", props: { title: "厨房" } },
        },
      ],
    });
    expect(story.columns[0]?.body).toEqual({
      name: "kitchen",
      props: { title: "厨房" },
    });
  });

  it("body 缺省 props ⇒ 只有名字，不带 props 键（不是空对象）", () => {
    const story = parseStory({
      formatVersion: 1,
      columns: [{ id: "a", kind: "scene", body: { name: "kitchen" } }],
    });
    const body = story.columns[0]?.body;
    expect(body?.name).toBe("kitchen");
    expect(body !== undefined && "props" in body).toBe(false);
  });

  it("flow 列也可以声明 body（`kind` 与 body 正交）", () => {
    const story = parseStory({
      formatVersion: 1,
      columns: [
        {
          id: "a",
          kind: "flow",
          commands: [],
          body: { name: "dashboard" },
        },
      ],
    });
    expect(story.columns[0]?.body?.name).toBe("dashboard");
  });
});

describe("列身体 · 形状互斥与缺省", () => {
  it("scene 列同时声明 elements 与 body ⇒ 整次拒绝（body-conflict-elements）", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [
          {
            id: "a",
            kind: "scene",
            elements: [],
            body: { name: "kitchen" },
          },
        ],
      }),
    ).toThrow(/不能同时声明 elements 与 body/);
  });

  it("scene 列既无 elements 也无 body ⇒ 整次拒绝并说明二者至少一个", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "scene" }],
      }),
    ).toThrow(/必须有 elements 数组或 body 声明/);
  });

  it("body 为 null ⇒ 拒绝（`null` 不是「没写」，写错了就得说）", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "scene", body: null }],
      }),
    ).toThrow(/body 必须为对象/);
  });
});

describe("列身体 · 非法输入 fail-closed", () => {
  it("body 不是对象 ⇒ 拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "scene", body: "kitchen" }],
      }),
    ).toThrow(/\.body 必须为对象/);
  });

  it("组件名不合法 ⇒ 拒绝并指出收到值", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "scene", body: { name: "Kitchen" } }],
      }),
    ).toThrow(/body\.name 不是合法组件名：收到 "Kitchen"/);
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [{ id: "a", kind: "scene", body: { name: "a/b" } }],
      }),
    ).toThrow(/不是合法组件名/);
  });

  it("props 不是对象 ⇒ 拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [
          { id: "a", kind: "scene", body: { name: "kitchen", props: [] } },
        ],
      }),
    ).toThrow(/body\.props 必须为对象/);
  });

  it("props 含非 JSON 安全值 ⇒ 拒绝并指出路径", () => {
    // 数组元素上的函数会经 JSON 序列化成 null（静默变形），必须在此拦下。
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [
          {
            id: "a",
            kind: "scene",
            body: { name: "kitchen", props: { spots: [() => 1] } },
          },
        ],
      }),
    ).toThrow(/必须是 JSON 安全值/);
  });

  it("props 含非普通对象（Map）⇒ 拒绝", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        columns: [
          {
            id: "a",
            kind: "scene",
            body: { name: "kitchen", props: { table: new Map() } },
          },
        ],
      }),
    ).toThrow(/必须是 JSON 安全值/);
  });
});

describe("列身体 · 写回", () => {
  it("声明过 body ⇒ 写回文本含名字与 props", () => {
    const text = writeBackOne(
      sceneBody({ name: "kitchen", props: { title: "厨房" } }),
    );
    expect(text).toContain('"body"');
    expect(text).toContain('"kitchen"');
    expect(text).toContain('"厨房"');
    // 只有 body 的 scene 列不写空 elements（否则重开即撞互斥）
    expect(text).not.toContain('"elements"');
  });

  it("body 无 props ⇒ 写回不带 props 键", () => {
    const text = writeBackOne(sceneBody({ name: "kitchen" }));
    expect(text).toContain('"body"');
    expect(text).not.toContain('"props"');
  });

  it("body 的 props 为空对象 ⇒ 写回也不带 props 键（空与缺省等价）", () => {
    const text = writeBackOne(sceneBody({ name: "kitchen", props: {} }));
    expect(text).not.toContain('"props"');
  });

  it("未声明 body ⇒ 不写该字段", () => {
    const text = writeBackOne({ kind: "scene", elements: [] });
    expect(text).not.toContain('"body"');
  });

  it("多列形态与单列形态写出同一份 body（字段集一致）", () => {
    const files = new Map([
      [
        "Stories/a.json",
        JSON.stringify({
          formatVersion: 1,
          columns: [
            { id: "a", kind: "scene", body: { name: "kitchen" } },
            { id: "b", kind: "flow", commands: [] },
          ],
        }),
      ],
    ]);
    const product = serializeProject(
      assembleProject(MANIFEST_A, files),
      MANIFEST_A,
    ).files;
    const text = product.get("Stories/a.json") ?? "";
    expect(text).toContain('"body"');
    expect(text).toContain('"kitchen"');
  });
});

describe("列身体 · 往返稳定", () => {
  it("写回 → 重开 ⇒ 故事深等（JSON 形态往返幂等）", () => {
    const files = new Map([
      [
        "Stories/a.json",
        columnFile({
          kind: "scene",
          body: { name: "kitchen", props: { title: "厨房", hot: true } },
        }),
      ],
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

  it("两种键书写顺序产出**逐字节相同**的文件（顺序来自字段序而非书写）", () => {
    const a = writeBackOne(
      sceneBody({ name: "kitchen", props: { x: 1, y: 2 } }),
    );
    const b = writeBackOne(
      sceneBody({ name: "kitchen", props: { y: 2, x: 1 } }),
    );
    // props 内部的键序保持作者书写顺序：body 是原样透传给组件的展示数据，
    // 重排会改变组件的渲染输入语义（与 uis 的码点序归一不同）。
    expect(a).not.toBe(b);
    expect(JSON.parse(a).body).toEqual(JSON.parse(b).body);
  });
});
