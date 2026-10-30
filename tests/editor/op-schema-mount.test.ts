/**
 * `mount` 的编辑器侧契约：schema 字段面、表单字段表、词汇层 builder、DSL 往返。
 *
 * 五个同步点里最容易漏的是**表单字段表**与**归组**——漏了不会报编译错误，
 * 只会在面板上表现为「命令能配出来，但属性面板一片空白、插入菜单里找不到」。
 * 所以这里逐点正面断言。
 *
 * 注意 schema 只校验**负载**：`op` 是路由键，不在 payload 里
 * （`OP_SCHEMAS[op]` 本身就是那个键承载的东西），塞进去会被 strictObject 拒。
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan-engine/core";
import { parseStory, parseTextStory, projectText } from "@lingfan-engine/core";
import { OP_SCHEMAS } from "@lingfan-engine/editor";
import * as script from "@lingfan-engine/editor";
import {
  FIELD_META,
  OP_GROUP_LABELS,
  OP_GROUP_ORDER,
  OP_META,
} from "../../packages/editor/src/schema/catalog.ts";

/** 把带 op 的命令拆成「op + 负载」，用于喂 payload schema */
function payloadOf(cmd: StoryCommand): {
  op: string;
  payload: Record<string, unknown>;
} {
  const { op, ...payload } = cmd as unknown as Record<string, unknown> & {
    op: string;
  };
  return { op, payload };
}

function singleColumn(commands: StoryCommand[]) {
  return parseStory({
    formatVersion: 1,
    id: "mount",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

describe("mount · schema 字段面", () => {
  it("进了 OP_SCHEMAS（漏了就配不出命令）", () => {
    expect(Object.keys(OP_SCHEMAS)).toContain("mount");
  });

  it("必填 name / visible，可选 props", () => {
    const schema = OP_SCHEMAS["mount"]!;
    expect(schema.safeParse({ name: "hub", visible: true }).success).toBe(true);
    expect(
      schema.safeParse({ name: "map", visible: false, props: { scene: "inn" } })
        .success,
    ).toBe(true);
    // 缺必填
    expect(schema.safeParse({ name: "hub" }).success).toBe(false);
    expect(schema.safeParse({ visible: true }).success).toBe(false);
    // visible 只收布尔：字符串 "true" 是常见手写错误，必须在编辑期就红
    expect(schema.safeParse({ name: "hub", visible: "true" }).success).toBe(
      false,
    );
  });

  it("name 必须是短标识（名字同时是产物键与目录名，形态必须统一）", () => {
    const schema = OP_SCHEMAS["mount"]!;
    expect(schema.safeParse({ name: "Hub", visible: true }).success).toBe(
      false,
    );
    expect(schema.safeParse({ name: "", visible: true }).success).toBe(false);
    expect(schema.safeParse({ name: "1hub", visible: true }).success).toBe(
      false,
    );
    expect(schema.safeParse({ name: "hub_2", visible: true }).success).toBe(
      true,
    );
    expect(schema.safeParse({ name: "hub-2", visible: true }).success).toBe(
      true,
    );
  });

  it("props 只收对象；未知字段被 strictObject 拒", () => {
    const schema = OP_SCHEMAS["mount"]!;
    expect(
      schema.safeParse({ name: "hub", visible: true, props: [1, 2] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ name: "hub", visible: true, props: "x" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ name: "hub", visible: true, bogus: 1 }).success,
    ).toBe(false);
  });
});

describe("mount · 表单字段表与归组", () => {
  it("三条字段元数据齐备（缺了属性面板一片空白）", () => {
    const fields: [string, string, string][] = [
      ["mount.name", "UI 名", "text"],
      ["mount.visible", "挂载", "boolean"],
      ["mount.props", "入参", "object"],
    ];
    for (const [key, label, kind] of fields) {
      expect(FIELD_META[key]?.label, key).toBe(label);
      expect(FIELD_META[key]?.kind, key).toBe(kind);
    }
  });

  it("归到 ui 组，且该组在分组顺序与中文标签里都登记了", () => {
    const meta = OP_META.find((entry) => entry.op === "mount");
    expect(meta?.group).toBe("ui");
    expect(meta?.label).toBe("挂载 UI 显隐");
    expect(OP_GROUP_ORDER).toContain("ui");
    expect(OP_GROUP_LABELS.ui).toBe("UI");
  });
});

describe("mount · 词汇层 builder", () => {
  it("mount 是函数值（词汇层双射的一端）", () => {
    expect(typeof script.mount).toBe("function");
  });

  it("句柄两条路取到同一个名字：字符串与 UiHandle", () => {
    const byName = script.mount("hub", true);
    const handle: script.UiHandle<"hub"> = { face: "uis", name: "hub" };
    expect(script.mount(handle, true)).toEqual(byName);
    expect(byName).toEqual({ op: "mount", name: "hub", visible: true });
  });

  it("props 只在给了的时候出现（没给就不写空对象）", () => {
    expect(script.mount("hub", false)).toEqual({
      op: "mount",
      name: "hub",
      visible: false,
    });
    expect(script.mount("hub", true, { scene: "inn" })).toEqual({
      op: "mount",
      name: "hub",
      visible: true,
      props: { scene: "inn" },
    });
  });

  it("builder 产物能过自己那格 schema（零漂移）", () => {
    const schema = OP_SCHEMAS["mount"]!;
    // 字符串形态受 `KnownUiName` 收窄（真实工程里只有已登记的 UI 名），
    // 其它名字走句柄形态——那才是路一的写法，名字来自 `*.vue` 导入。
    const map: script.UiHandle<"map"> = { face: "uis", name: "map" };
    for (const cmd of [
      script.mount("hub", true),
      script.mount(map, false),
      script.mount(map, true, { scene: "forest" }),
    ]) {
      const { op, payload } = payloadOf(cmd);
      expect(op).toBe("mount");
      expect(schema.safeParse(payload).success, JSON.stringify(cmd)).toBe(true);
    }
  });
});

describe("mount · DSL 往返", () => {
  const map: script.UiHandle<"map"> = { face: "uis", name: "map" };
  const commands: StoryCommand[] = [
    script.mount("hub", true),
    script.mount(map, false),
    script.mount(map, true, { scene: "forest" }),
  ];

  it("JSON → 文本 → JSON 等价", () => {
    const text = projectText(singleColumn(commands)).text;
    expect(parseTextStory(text).columns[0]?.commands).toEqual(commands);
  });
});
