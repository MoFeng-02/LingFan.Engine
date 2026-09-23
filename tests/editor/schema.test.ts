/**
 * 06-D2/D3 op schema 单一事实源测试：
 * - 全 49 op canonical 样本「引擎 parseStory 与编辑器 schema 双接受」跨包互锁
 * - 必填字段删除「两侧同拒」（format.ts 深校验子集）
 * - 未知字段 / 未知 op / 类型错 fail-closed（E3/F5 编辑期）
 * - 表单描述符派生 + 目录×schema 字段名集合互锁（D2）
 * - 行内标记白名单与执行器 interpolateText 行为互锁
 * 锚点: schema-driven-forms / edit-time-validation
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import {
  describeForm,
  extractExpressionRefs,
  listOps,
  validateCommand,
  validateStory,
} from "@lingfan/editor";
import { OP_SCHEMAS } from "../../packages/editor/src/schema/opSchemas";
import { FIELD_META } from "../../packages/editor/src/schema/catalog";
import {
  parseStory,
  StoryFormatError,
} from "../../packages/engine/src/data/format";
import { interpolateText } from "../../packages/engine/src/runtime/expr";

/** format.ts 深校验 op 集（validateCommand switch 覆盖面）——必填删除需两侧同拒 */
const DEEP_FORMAT_OPS = new Set([
  "say",
  "if",
  "menu",
  "set",
  "define",
  "let",
  "local",
  "undef",
  "jump",
  "navigate",
  "save",
  "load",
  "save_delete",
  "auto_save",
  "notify",
  "wait",
  "pause",
  "while",
  "for",
  "foreach",
  "switch",
  "break",
  "continue",
  "array",
  "array_push",
  "array_pop",
  "dict",
  "dict_set",
  "func",
  "call",
  "return",
  "input",
  "random",
  "minigame",
]);

const CANONICAL: Record<string, Record<string, unknown>> = {
  say: {
    op: "say",
    text: "你好",
    speaker: "灵泛",
    clickable: true,
    noskip: false,
    instant: true,
    typewriter: 30,
    voice: "Audio/v.ogg",
    template: "center",
  },
  menu: {
    op: "menu",
    prompt: "去哪",
    options: [
      { text: "酒馆", target: "inn" },
      { text: "广场", target: "square" },
    ],
  },
  input: { op: "input", prompt: "名字", store: "player.name" },
  notify: { op: "notify", text: "提示", type: "info", duration: 2000 },
  nvl: { op: "nvl" },
  character: {
    op: "character",
    key: "lingfan",
    name: "灵泛",
    color: "#7aa2f7",
    size: "22",
    font: "serif",
    textColor: "#ffffff",
    screen: "center",
  },
  wait: { op: "wait", seconds: 1.5, skipable: true },
  pause: { op: "pause", seconds: 2 },
  random: { op: "random", seed: 42, range: [1, 6], var: "roll" },
  jump: { op: "jump", target: "inn" },
  navigate: { op: "navigate", path: "square", scene: "plaza" },
  call: { op: "call", target: "greet", args: ["{player.name}", 1, true] },
  return: { op: "return", value: 1 },
  if: {
    op: "if",
    cond: "{gold >= 25}",
    then: [{ op: "say", text: "a" }],
    elif: [{ cond: "{gold >= 10}", then: [{ op: "say", text: "b" }] }],
    else: [{ op: "say", text: "c" }],
  },
  while: {
    op: "while",
    cond: "{i < 3}",
    body: [{ op: "set", key: "i", value: "+= {1}" }],
  },
  for: { op: "for", var: "i", in: "{items}", body: [{ op: "say", text: "x" }] },
  foreach: {
    op: "foreach",
    var: "v",
    key: "items",
    body: [{ op: "say", text: "x" }],
  },
  switch: {
    op: "switch",
    on: "{n}",
    cases: [
      { value: 1, body: [{ op: "say", text: "一" }] },
      { value: 2, body: [{ op: "say", text: "二" }] },
    ],
    default: [{ op: "say", text: "其他" }],
  },
  break: { op: "break" },
  continue: { op: "continue" },
  set: { op: "set", key: "gold", value: 10 },
  define: { op: "define", key: "greeting", value: "hello" },
  let: { op: "let", key: "tmp", value: "{gold}" },
  local: { op: "local", key: "tmp2", value: "x" },
  undef: { op: "undef", key: "tmp" },
  array: { op: "array", key: "bag", items: ["剑", 2, true], once: true },
  array_push: { op: "array_push", key: "bag", value: "盾" },
  array_pop: { op: "array_pop", key: "bag" },
  dict: {
    op: "dict",
    key: "stats",
    value: { hp: 10, name: "旅人" },
    once: true,
  },
  dict_set: { op: "dict_set", key: "stats", field: "hp", value: 99 },
  save: { op: "save", slot: "slot_1", title: "第一章" },
  load: { op: "load", slot: "slot_1" },
  auto_save: { op: "auto_save", enabled: true },
  save_delete: { op: "save_delete", slot: "slot-1" },
  bgm: {
    op: "bgm",
    resource: "Audio/bgm.mp3",
    volume: 0.4,
    loop: true,
    fade: 1200,
    restart: false,
  },
  stop_bgm: { op: "stop_bgm", fade: 300 },
  se: { op: "se", resource: "Audio/se.mp3", volume: 0.7 },
  ambient: {
    op: "ambient",
    resource: "Audio/rain.mp3",
    volume: 0.5,
    loop: true,
    fade: 0,
    restart: true,
  },
  stop_ambient: { op: "stop_ambient", fade: 0 },
  voice: {
    op: "voice",
    resource: "Audio/v1.ogg",
    volume: 1,
    auto_stop: true,
    restart: false,
  },
  stop_voice: { op: "stop_voice", fade: 0 },
  video: { op: "video", resource: "Video/m1.mp4", volume: 0.8, loop: false },
  cutscene: {
    op: "cutscene",
    resource: "Video/m1.mp4",
    volume: 0.8,
    skipable: true,
  },
  seek_video: { op: "seek_video", seconds: 3.5 },
  pause_video: { op: "pause_video" },
  resume_video: { op: "resume_video" },
  stop_video: { op: "stop_video" },
  video_skipable: { op: "video_skipable", value: false },
  minigame: {
    op: "minigame",
    game: "puzzle",
    config: { hp: 3, tip: "动脑" },
    on_success: "win",
    on_fail: "lose",
    reward: [
      { key: "gold", value: "{20}" },
      { key: "badge", value: "智者" },
    ],
  },
};

function columnOf(id: string, commands: StoryCommand[]): StoryColumn {
  return { id, kind: "flow", commands };
}

function corpusStory(): Story {
  const ops = Object.keys(CANONICAL);
  return {
    formatVersion: 1,
    id: "corpus",
    entry: "ops",
    columns: [
      columnOf(
        "ops",
        ops.map((op) => CANONICAL[op] as StoryCommand),
      ),
      columnOf("inn", [{ op: "say", text: "酒馆" }]),
      columnOf("square", [{ op: "say", text: "广场" }]),
      columnOf("plaza", [{ op: "say", text: "广场景" }]),
    ],
    defines: { "player.gold": 100 },
  };
}

describe("op 全集 canonical 语料：引擎解析与编辑器 schema 双接受（跨包互锁）", () => {
  it("全部 50 op：parseStory 不抛 + validateStory 零诊断", () => {
    expect(Object.keys(CANONICAL)).toHaveLength(listOps().length);
    const story = corpusStory();
    expect(() => parseStory(structuredClone(story), "corpus")).not.toThrow();
    expect(validateStory(story)).toEqual([]);
  });

  it("逐 op 单列原子文件：parseStory 与 validateCommand 双接受", () => {
    for (const [op, cmd] of Object.entries(CANONICAL)) {
      const file = {
        formatVersion: 1,
        id: "c",
        kind: "flow" as const,
        commands: [structuredClone(cmd)],
      };
      expect(() => parseStory(file, "c"), `parseStory: ${op}`).not.toThrow();
      expect(validateCommand(cmd), `validateCommand: ${op}`).toEqual([]);
    }
  });
});

describe("必填字段删除：两侧同拒（format.ts 深校验子集互锁）", () => {
  for (const [op, cmd] of Object.entries(CANONICAL)) {
    const descriptor = describeForm(op);
    if (descriptor === undefined) throw new Error(`缺表单：${op}`);
    const requiredKeys = descriptor.fields
      .filter((field) => field.required)
      .map((field) => field.key);
    if (requiredKeys.length === 0) continue;
    for (const key of requiredKeys) {
      it(`${op} 删除必填 ${key} → schema 拒绝${DEEP_FORMAT_OPS.has(op) ? " 且 parseStory 拒绝" : ""}`, () => {
        const broken = structuredClone(cmd);
        delete broken[key];
        const issues = validateCommand(broken);
        expect(issues.length, JSON.stringify(issues)).toBeGreaterThan(0);
        expect(
          issues.some(
            (issue) =>
              issue.code === "missing-required" ||
              issue.code === "invalid-value",
          ),
        ).toBe(true);
        if (DEEP_FORMAT_OPS.has(op)) {
          const file = {
            formatVersion: 1,
            id: "c",
            kind: "flow" as const,
            commands: [broken],
          };
          expect(() => parseStory(file, "c")).toThrow(StoryFormatError);
        }
      });
    }
  }
});

describe("编辑期 fail-closed（D3）", () => {
  it("未知负载字段 → unknown-field（全 op 扫描）", () => {
    for (const [op, cmd] of Object.entries(CANONICAL)) {
      const broken = { ...structuredClone(cmd), __bogus: true };
      const issues = validateCommand(broken);
      expect(
        issues.some((i) => i.code === "unknown-field"),
        `op=${op}`,
      ).toBe(true);
      expect(issues.every((i) => i.op === op)).toBe(true);
    }
  });

  it("未知 op / 非对象 / 缺 op → fail-closed 诊断", () => {
    expect(validateCommand({ op: "teleport" })[0]?.code).toBe("unknown-op");
    expect(validateCommand(null)[0]?.code).toBe("invalid-structure");
    expect(validateCommand([1])[0]?.code).toBe("invalid-structure");
    expect(validateCommand({ text: "x" })[0]?.code).toBe("invalid-structure");
  });

  it("evalValue 标量面：对象/数组/null 进 value 字段 = 拒绝（执行期 type-error 的编辑期镜像）", () => {
    expect(
      validateCommand({ op: "set", key: "a", value: { nested: 1 } })[0]?.code,
    ).toBe("invalid-value");
    expect(validateCommand({ op: "set", key: "a", value: null })[0]?.code).toBe(
      "invalid-value",
    );
    expect(
      validateCommand({ op: "array", key: "a", items: [{ o: 1 }] })[0]?.code,
    ).toBe("invalid-value");
    expect(
      validateCommand({ op: "call", target: "f", args: [[]] })[0]?.code,
    ).toBe("invalid-value");
    expect(
      validateCommand({ op: "dict", key: "a", value: { ok: 1, bad: [1] } })[0]
        ?.code,
    ).toBe("invalid-value");
    expect(validateCommand({ op: "set", key: "a", value: "{1+1}" })).toEqual(
      [],
    );
  });

  it("音量/淡出/秒数物理边界：fade 负数拒绝、volume 有限性拒绝、seek_video 负秒拒绝", () => {
    expect(
      validateCommand({ op: "bgm", resource: "a.mp3", fade: -1 })[0]?.code,
    ).toBe("invalid-value");
    expect(
      validateCommand({
        op: "bgm",
        resource: "a.mp3",
        volume: Number.POSITIVE_INFINITY,
      })[0]?.code,
    ).toBe("invalid-value");
    expect(validateCommand({ op: "seek_video", seconds: -1 })[0]?.code).toBe(
      "invalid-value",
    );
    expect(
      validateCommand({ op: "bgm", resource: "a.mp3", volume: 1.5 }),
    ).toEqual([]);
  });

  it("槽位名规则镜像执行器 validSlot（save/save_delete 有、load 无）", () => {
    expect(validateCommand({ op: "save", slot: "bad slot!" })[0]?.code).toBe(
      "invalid-value",
    );
    expect(
      validateCommand({ op: "save_delete", slot: "bad slot!" })[0]?.code,
    ).toBe("invalid-value");
    expect(validateCommand({ op: "load", slot: "任意非空" })).toEqual([]);
  });

  it("nvl 未知 mode / voice 未知字段 loop 拒绝", () => {
    expect(validateCommand({ op: "nvl", mode: "bogus" })[0]?.code).toBe(
      "invalid-value",
    );
    expect(
      validateCommand({ op: "voice", resource: "v.ogg", loop: true })[0]?.code,
    ).toBe("unknown-field");
  });

  it("嵌套块体内的坏命令拿到精确 JSON Pointer（D6）", () => {
    const story: Story = {
      formatVersion: 1,
      id: "s",
      entry: "c",
      columns: [
        columnOf("c", [
          {
            op: "if",
            cond: "{true}",
            then: [
              {
                op: "switch",
                on: "{n}",
                cases: [{ value: 1, body: [{ op: "teleport" }] }],
              },
            ],
          },
        ]),
      ],
    };
    const issues = validateStory(story);
    const hit = issues.find((issue) => issue.code === "unknown-op");
    expect(hit?.pointer).toBe("/columns/0/commands/0/then/0/cases/0/body/0");
  });
});

describe("表单描述符派生（D2：schema 驱动表单）", () => {
  it("目录×schema 字段名集合双向互锁（49 op 全量）", () => {
    for (const meta of listOps()) {
      const shape = (OP_SCHEMAS[meta.op].def as z.core.$ZodObjectDef).shape;
      const descriptor = describeForm(meta.op);
      expect(descriptor, meta.op).toBeDefined();
      expect(descriptor?.group).toBe(meta.group);
      expect(descriptor?.label).toBe(meta.label);
      const schemaKeys = Object.keys(shape).sort();
      const descriptorKeys = descriptor?.fields
        .map((field) => field.key)
        .sort();
      expect(descriptorKeys, meta.op).toEqual(schemaKeys);
      for (const key of schemaKeys) {
        expect(
          FIELD_META[`${meta.op}.${key}`],
          `${meta.op}.${key}`,
        ).toBeDefined();
      }
    }
  });

  it("say：必填 text + 可选面 + 标签来自目录", () => {
    const descriptor = describeForm("say");
    const byKey = new Map(
      descriptor?.fields.map((field) => [field.key, field]),
    );
    expect(byKey.get("text")?.required).toBe(true);
    expect(byKey.get("text")?.label).toBe("文本");
    expect(byKey.get("text")?.kind).toBe("text");
    expect(byKey.get("speaker")?.required).toBe(false);
    expect(byKey.get("voice")?.kind).toBe("resource");
    expect(byKey.get("clickable")?.kind).toBe("boolean");
    expect(byKey.get("typewriter")?.kind).toBe("number");
  });

  it("menu 嵌套项描述符（options[].text/target）", () => {
    const options = describeForm("menu")?.fields.find(
      (field) => field.key === "options",
    );
    expect(options?.required).toBe(true);
    expect(options?.item?.properties?.map((p) => p.key)).toEqual([
      "text",
      "target",
    ]);
    expect(options?.item?.properties?.[0]?.label).toBe("选项文本");
    expect(options?.item?.properties?.[1]?.kind).toBe("identifier");
  });

  it("nvl 枚举可选值来自 schema", () => {
    const mode = describeForm("nvl")?.fields.find(
      (field) => field.key === "mode",
    );
    expect(mode?.kind).toBe("enum");
    expect(mode?.enumValues).toEqual(["enter", "auto", "clear", "exit"]);
    expect(mode?.required).toBe(false);
  });

  it("random 范围 tuple 描述符 + 字段语义 kind 驱动诊断扫描面", () => {
    const descriptor = describeForm("random");
    const range = descriptor?.fields.find((field) => field.key === "range");
    expect(range?.kind).toBe("tuple");
    expect(range?.tupleItems).toHaveLength(2);
    expect(descriptor?.fields.find((field) => field.key === "seed")?.kind).toBe(
      "integer",
    );
    expect(descriptor?.fields.find((field) => field.key === "var")?.kind).toBe(
      "identifier",
    );
  });
});

describe("行内标记白名单与执行器 interpolateText 行为互锁", () => {
  const resolver = (defined: Set<string>) => (name: string) =>
    defined.has(name)
      ? { found: true as const, value: 1 }
      : { found: false as const };

  const PROBES = [
    "{b}粗{/b}",
    "{i}",
    "{/i}",
    "{u}下划线{/u}",
    "{color=#FFD700}金{/color}",
    "{size=22}大{/size}",
    "{font=serif}字{/font}",
    "{p}",
    "{w}",
    "{fast}",
    "{p}文本{color=#fff}x{/color}",
    "{ghostVar}",
    "{gold}枚",
    "无标记文本",
    "{gold:000}补零",
  ];

  it("引擎无错误 ⟺ 编辑器不报未定义变量（含已定义变量 > 行内标记冲突裁定）", () => {
    const defined = new Set(["gold"]);
    for (const text of PROBES) {
      const engineResult = interpolateText(text, resolver(defined));
      const engineFailed = engineResult.errors.length > 0;
      const editorFailed = extractRefsFromText(
        text,
        extractExpressionRefs,
      ).some((name) => !defined.has(name));
      expect(engineFailed, `引擎判定: ${text}`).toBe(editorFailed);
    }
  });
});

/** 复刻 diagnostics 内部扫描逻辑的测试侧镜像（仅供互锁断言用） */
function extractRefsFromText(
  text: string,
  extract: (expr: string) => string[],
): string[] {
  const refs: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) break;
    const content = text.slice(i + 1, end).trim();
    const INLINE_SHORT = new Set([
      "b",
      "/b",
      "i",
      "/i",
      "u",
      "/u",
      "w",
      "fast",
      "p",
      "color",
      "font",
      "size",
    ]);
    const INLINE_PREFIXED = [
      "color=",
      "/color",
      "font=",
      "/font",
      "size=",
      "/size",
    ];
    const isInline =
      INLINE_SHORT.has(content) ||
      INLINE_PREFIXED.some((p) => content.startsWith(p));
    if (!isInline) {
      let exprSrc = content;
      if (!content.includes("?")) {
        const colon = content.indexOf(":");
        if (colon > 0) exprSrc = content.slice(0, colon).trim();
      }
      refs.push(...extract(exprSrc));
    }
    i = end + 1;
  }
  return refs;
}
