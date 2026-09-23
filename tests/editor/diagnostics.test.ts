/**
 * 06 §一.2 诊断集测试：符号索引 + 未定义变量（`_` 豁免 D4 + 行内标记不误报）+
 * 跳转目标（F1）/入口列/重复 columnId/资源/翻译缺口；全部诊断带可解析 JSON Pointer（D6）。
 * 锚点: diagnostics-with-pointer / undefined-var-underscore-exempt
 */

import { describe, expect, it } from "vitest";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import { analyzeStory, getAtPointer, indexStory } from "@lingfan/editor";

function flowColumn(id: string, commands: StoryCommand[]): StoryColumn {
  return { id, kind: "flow", commands };
}

function baseStory(commands: StoryCommand[]): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "start",
    columns: [
      flowColumn("start", commands),
      flowColumn("inn", [{ op: "say", text: "酒馆" }]),
    ],
  };
}

/** D6：每个诊断的指针自身可解析，或其父路径可解析（missing-required 指向应存在字段） */
function expectPointersResolvable(
  story: Story,
  diagnostics: ReturnType<typeof analyzeStory>,
): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.pointer === "") continue;
    const self = getAtPointer(story, diagnostic.pointer);
    if (self !== undefined) continue;
    const parent = diagnostic.pointer.split("/").slice(0, -1).join("/");
    expect(
      getAtPointer(story, parent),
      `${diagnostic.code} @ ${diagnostic.pointer}`,
    ).not.toBeUndefined();
  }
}

describe("符号索引（indexStory）", () => {
  it("收集列/defines/变量定义/函数/目标/资源/可翻译原文", () => {
    const story = baseStory([
      { op: "set", key: "gold", value: 10 },
      { op: "define", key: "greeting", value: "hi" },
      { op: "array", key: "bag", items: [] },
      { op: "random", seed: 1, range: [0, 1], var: "roll" },
      { op: "input", prompt: "名字", store: "player.name" },
      {
        op: "func",
        name: "greet",
        params: ["who"],
        body: [{ op: "say", text: "{who}" }],
      },
      { op: "jump", target: "inn" },
      { op: "call", target: "greet" },
      {
        op: "menu",
        prompt: "去哪",
        options: [{ text: "酒馆", target: "inn" }],
      },
      { op: "navigate", path: "square" },
      { op: "bgm", resource: "Audio/bgm.mp3" },
      { op: "say", text: "你好{gold}", speaker: "灵泛" },
    ]);
    const index = indexStory(story);
    expect(index.columnPointers.get("start")).toBe("/columns/0");
    expect(index.definedKeys.has("gold")).toBe(true);
    expect(index.definedKeys.has("greeting")).toBe(true);
    expect(index.definedKeys.has("bag")).toBe(true);
    expect(index.definedKeys.has("roll")).toBe(true);
    expect(index.definedKeys.has("player.name")).toBe(true);
    expect(index.functions.get("greet")?.params).toEqual(["who"]);
    expect(index.targets.filter((t) => t.kind === "column")).toHaveLength(3);
    expect(index.targets.filter((t) => t.kind === "function")).toHaveLength(1);
    expect(index.resources).toEqual([
      { pointer: "/columns/0/commands/10/resource", path: "Audio/bgm.mp3" },
    ]);
    expect(index.originals.has("你好{gold}")).toBe(true);
    expect(index.originals.has("名字")).toBe(true);
    expect(index.originals.has("酒馆")).toBe(true);
    expect(index.originals.has("去哪")).toBe(true);
  });

  it("重复 columnId 入 duplicateColumns（F1）", () => {
    const story: Story = {
      formatVersion: 1,
      id: "d",
      entry: "a",
      columns: [flowColumn("a", []), flowColumn("a", []), flowColumn("b", [])],
    };
    const index = indexStory(story);
    expect(index.duplicateColumns).toEqual([
      { id: "a", pointer: "/columns/1" },
    ]);
  });
});

describe("诊断集（analyzeStory）", () => {
  it("干净故事零诊断 + 全诊断指针可解析", () => {
    const story = baseStory([
      { op: "set", key: "gold", value: 10 },
      { op: "say", text: "有 {gold} 金币，{b}粗体{/b} 不误报。" },
      { op: "jump", target: "inn" },
    ]);
    const diagnostics = analyzeStory(story, {
      resourceFiles: new Set(["Audio/x.mp3"]),
      overlayKeys: new Set(["有 {gold} 金币，{b}粗体{/b} 不误报。", "酒馆"]),
    });
    expect(diagnostics).toEqual([]);
  });

  it("跳转目标不存在（F1）/未知函数/入口列缺失/重复列", () => {
    const story = baseStory([
      { op: "jump", target: "ghost" },
      { op: "call", target: "no_func" },
      { op: "menu", prompt: "m", options: [{ text: "x", target: "ghost" }] },
      { op: "navigate", path: "ghost" },
    ]);
    story.entry = "ghost";
    story.columns.push(flowColumn("start", []));
    const diagnostics = analyzeStory(story);
    const byCode = (code: string) => diagnostics.filter((d) => d.code === code);
    expect(byCode("missing-target")).toHaveLength(3);
    expect(byCode("unknown-function")).toHaveLength(1);
    expect(byCode("missing-entry")[0]?.pointer).toBe("/entry");
    expect(byCode("duplicate-column")[0]?.pointer).toBe("/columns/2");
    expectPointersResolvable(story, diagnostics);
  });

  it("未定义变量：表达式 = error、插值 = warning（S5/S8 语义差）", () => {
    const story = baseStory([
      { op: "if", cond: "{ghost > 1}", then: [{ op: "say", text: "x" }] },
      { op: "say", text: "{ghostName}你好" },
      { op: "switch", on: "{missing}", cases: [{ value: 1, body: [] }] },
    ]);
    const diagnostics = analyzeStory(story);
    const undefinedVars = diagnostics.filter(
      (d) => d.code === "undefined-variable",
    );
    expect(undefinedVars).toHaveLength(3);
    expect(undefinedVars.filter((d) => d.severity === "error")).toHaveLength(2);
    expect(undefinedVars.filter((d) => d.severity === "warning")).toHaveLength(
      1,
    );
    expectPointersResolvable(story, diagnostics);
  });

  it("点路径整键语义（04 §二.9）：defines/player.gold 与表达式 player.gold 视为同一键", () => {
    const ok = baseStory([
      { op: "set", key: "player.gold", value: 10 },
      { op: "if", cond: "{player.gold >= 10}", then: [] },
      { op: "say", text: "余额 {player.gold}" },
    ]);
    expect(
      analyzeStory(ok).filter((d) => d.code === "undefined-variable"),
    ).toEqual([]);
    // 只有 "player"（非 "player.gold"）→ 点路径未定义，诊断指向整路径
    const missing = baseStory([
      { op: "set", key: "player", value: 1 },
      { op: "if", cond: "{player.gold >= 10}", then: [] },
    ]);
    const undefinedVars = analyzeStory(missing)
      .map((d) => d.code === "undefined-variable" && d.message)
      .filter((m): m is string => typeof m === "string");
    expect(undefinedVars.some((m) => m.includes("player.gold"))).toBe(true);
    expectPointersResolvable(missing, analyzeStory(missing));
  });

  it("D4 `_` 前缀豁免", () => {
    const story = baseStory([
      { op: "if", cond: "{_internal > 0}", then: [] },
      { op: "say", text: "{_hidden}占位" },
      { op: "set", key: "_scratch", value: 1 },
    ]);
    expect(
      analyzeStory(story).filter((d) => d.code === "undefined-variable"),
    ).toEqual([]);
  });

  it("已定义变量 > 行内标记：{i} 已定义按变量不误报、未定义按标记不误报", () => {
    const defined = baseStory([
      { op: "let", key: "i", value: 0 },
      { op: "say", text: "{i}斜体还是变量" },
    ]);
    expect(
      analyzeStory(defined).filter((d) => d.code === "undefined-variable"),
    ).toEqual([]);
    const undefinedCase = baseStory([{ op: "say", text: "{i}斜体标记" }]);
    expect(
      analyzeStory(undefinedCase).filter(
        (d) => d.code === "undefined-variable",
      ),
    ).toEqual([]);
  });

  it("行内标记全族零误报（含 {color=#f00}{p}{w}{fast}{size=22}）", () => {
    const story = baseStory([
      {
        op: "say",
        text: "{b}粗{/b}{i}斜{/i}{u}下{/u}{color=#f00}色{/color}{size=22}大{/size}{font=x}字{/font}{p}{w}{fast}",
      },
    ]);
    expect(analyzeStory(story)).toEqual([]);
  });

  it("value 字段 {expr} 与复合赋值扫描；for.in 表达式扫描", () => {
    const story = baseStory([
      { op: "set", key: "gold", value: "+= {income}" },
      { op: "set", key: "hp", value: "{base}" },
      { op: "for", var: "i", in: "{items}", body: [] },
    ]);
    const names = analyzeStory(story)
      .filter((d) => d.code === "undefined-variable")
      .map((d) => d.message);
    expect(names.some((m) => m.includes("income"))).toBe(true);
    expect(names.some((m) => m.includes("base"))).toBe(true);
    expect(names.some((m) => m.includes("items"))).toBe(true);
  });

  it("资源路径缺失（提供 resourceFiles 才诊断）", () => {
    const commands = [
      { op: "bgm", resource: "Audio/ok.mp3" },
      { op: "bgm", resource: "Audio/missing.mp3" },
      { op: "cutscene", resource: "Video/cut.mp4" },
      { op: "say", text: "x", voice: "Audio/v_missing.ogg" },
    ];
    const story = baseStory(commands);
    expect(
      analyzeStory(story).filter((d) => d.code === "missing-resource"),
    ).toEqual([]);
    const withFiles = analyzeStory(story, {
      resourceFiles: new Set(["Audio/ok.mp3", "Video/cut.mp4"]),
    });
    const missing = withFiles.filter((d) => d.code === "missing-resource");
    expect(missing).toHaveLength(2);
    expect(missing.map((d) => d.pointer).sort()).toEqual([
      "/columns/0/commands/1/resource",
      "/columns/0/commands/3/voice",
    ]);
    expectPointersResolvable(story, withFiles);
  });

  it("翻译缺口检查器：overlay 键 − 可翻译原文", () => {
    const story = baseStory([
      { op: "say", text: "你好" },
      {
        op: "menu",
        prompt: "去哪",
        options: [{ text: "酒馆", target: "inn" }],
      },
    ]);
    const diagnostics = analyzeStory(story, {
      overlayKeys: new Set([
        "你好",
        "去哪",
        "酒馆",
        "没被用到的键",
        "另一个孤儿",
      ]),
    });
    const unused = diagnostics.filter((d) => d.code === "unused-translation");
    expect(unused).toHaveLength(2);
    expect(unused.every((d) => d.severity === "warning")).toBe(true);
  });

  it("结构诊断（D3）与语义诊断同批返回且指针可解析", () => {
    const story = baseStory([
      { op: "say" },
      { op: "jump", target: "inn" },
      { op: "teleport" },
    ]);
    const diagnostics = analyzeStory(story);
    expect(diagnostics.some((d) => d.code === "missing-required")).toBe(true);
    expect(diagnostics.some((d) => d.code === "unknown-op")).toBe(true);
    expectPointersResolvable(story, diagnostics);
  });

  it("navigate 目标 = scene ?? path：有 scene 时 path 不作列目标", () => {
    const withScene = baseStory([
      { op: "navigate", path: "ghost", scene: "inn" },
    ]);
    expect(withScene.entry).toBe("start");
    expect(
      analyzeStory(withScene).filter((d) => d.code === "missing-target"),
    ).toEqual([]);
    const sceneGhost = baseStory([
      { op: "navigate", path: "inn", scene: "ghost" },
    ]);
    expect(
      analyzeStory(sceneGhost).filter((d) => d.code === "missing-target"),
    ).toHaveLength(1);
  });
});
