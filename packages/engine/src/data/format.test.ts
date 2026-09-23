/** 01-数据层测试：结构校验 fail-closed、columnId 唯一（F1）、双文件形态识别、per-op 结构校验 */
import { describe, expect, it } from "vitest";
import {
  baseName,
  isSingleColumnFile,
  parseStory,
  StoryFormatError,
} from "./format";

const validStory = {
  formatVersion: 1,
  id: "demo",
  columns: [
    { id: "start", kind: "flow", commands: [{ op: "say", text: "你好" }] },
  ],
};

describe("parseStory · 多列文件", () => {
  it("合法最小故事解析通过", () => {
    const story = parseStory(validStory);
    expect(story.id).toBe("demo");
    expect(story.entry).toBe("start");
    expect(story.columns[0]).toMatchObject({ id: "start", kind: "flow" });
  });

  it("缺 id 时按来源派生（组装层传文件路径）", () => {
    const rest: Record<string, unknown> = { ...validStory };
    delete rest.id;
    expect(parseStory(rest, "Stories/chapter1.json").id).toBe("chapter1");
  });

  it("formatVersion 非 1 整次拒绝", () => {
    expect(() => parseStory({ ...validStory, formatVersion: 2 })).toThrow(
      StoryFormatError,
    );
  });

  it("根节点非对象整次拒绝", () => {
    expect(() => parseStory("demo")).toThrow(StoryFormatError);
    expect(() => parseStory(null)).toThrow(StoryFormatError);
  });

  it("columnId 重复拒绝（F1）", () => {
    const story = {
      ...validStory,
      columns: [
        { id: "start", kind: "flow", commands: [] },
        { id: "start", kind: "flow", commands: [] },
      ],
    };
    try {
      parseStory(story);
      expect.unreachable("应当抛出 StoryFormatError");
    } catch (e) {
      expect(e).toBeInstanceOf(StoryFormatError);
      expect((e as StoryFormatError).issues.join("\n")).toContain(
        "columnId 重复",
      );
    }
  });

  it("flow 列缺 commands 拒绝；scene 列缺 elements 拒绝；kind 非法拒绝", () => {
    expect(() =>
      parseStory({ ...validStory, columns: [{ id: "a", kind: "flow" }] }),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory({ ...validStory, columns: [{ id: "a", kind: "scene" }] }),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory({
        ...validStory,
        columns: [{ id: "a", kind: "plot", commands: [] }],
      }),
    ).toThrow(StoryFormatError);
  });

  it("entry 指向不存在列拒绝；缺 entry 默认首列", () => {
    expect(() => parseStory({ ...validStory, entry: "nope" })).toThrow(
      StoryFormatError,
    );
    expect(parseStory(validStory).entry).toBe("start");
  });
});

describe("parseStory · 单列原子文件（07 §三）", () => {
  const single = {
    formatVersion: 1,
    id: "start",
    kind: "flow",
    commands: [{ op: "say", text: "你好" }],
    defines: { "player.gold": 7 },
  };

  it("顶层即列对象，entry = 自身 id，defines 保留", () => {
    const story = parseStory(single, "Stories/start.json");
    expect(story.columns).toHaveLength(1);
    expect(story.columns[0]).toMatchObject({ id: "start", kind: "flow" });
    expect(story.entry).toBe("start");
    expect(story.defines).toEqual({ "player.gold": 7 });
  });

  it("形态歧义（columns 与 kind 并存）拒绝", () => {
    expect(() => parseStory({ ...single, columns: [] })).toThrow(
      StoryFormatError,
    );
  });

  it("两种形态都无法识别拒绝", () => {
    expect(() => parseStory({ formatVersion: 1, title: "x" })).toThrow(
      StoryFormatError,
    );
  });

  it("isSingleColumnFile / baseName 判定", () => {
    expect(isSingleColumnFile(single)).toBe(true);
    expect(isSingleColumnFile(validStory)).toBe(false);
    expect(baseName("Stories/chapter1/tavern.json")).toBe("tavern");
    expect(baseName("C:\\repo\\Stories\\inn.json")).toBe("inn");
    expect(baseName("README")).toBe("README");
  });
});

describe("per-op 结构校验（fail-closed，老规范 §八.4）", () => {
  const withCommands = (commands: unknown[]): unknown => ({
    ...validStory,
    columns: [{ id: "start", kind: "flow", commands }],
  });

  it("say 缺 text 拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "say", speaker: "x" }])),
    ).toThrow(StoryFormatError);
  });

  it("if 缺 then 拒绝；嵌套块内坏命令递归拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "if", cond: "{true}" }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(
        withCommands([{ op: "if", cond: "{true}", then: [{ op: "say" }] }]),
      ),
    ).toThrow(StoryFormatError);
  });

  it("menu 缺 options / 选项缺 target 拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "menu", options: [] }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(withCommands([{ op: "menu", options: [{ text: "酒馆" }] }])),
    ).toThrow(StoryFormatError);
  });

  it("set 缺 value 拒绝；value=0 合法（in 判定非真值判定）", () => {
    expect(() => parseStory(withCommands([{ op: "set", key: "x" }]))).toThrow(
      StoryFormatError,
    );
    expect(() =>
      parseStory(withCommands([{ op: "set", key: "x", value: 0 }])),
    ).not.toThrow();
  });

  it("jump 缺 target、undef 缺 key、notify 缺 text 拒绝", () => {
    expect(() => parseStory(withCommands([{ op: "jump" }]))).toThrow(
      StoryFormatError,
    );
    expect(() => parseStory(withCommands([{ op: "undef" }]))).toThrow(
      StoryFormatError,
    );
    expect(() =>
      parseStory(withCommands([{ op: "notify", duration: 1 }])),
    ).toThrow(StoryFormatError);
  });

  it("未实现 op 结构放行（执行器 fail-closed，E3）", () => {
    expect(() =>
      parseStory(withCommands([{ op: "teleport", target: "x" }])),
    ).not.toThrow();
  });

  it("wait 缺/错 seconds 拒绝；skipable 必须为布尔；pause 同", () => {
    expect(() => parseStory(withCommands([{ op: "wait" }]))).toThrow(
      StoryFormatError,
    );
    expect(() =>
      parseStory(withCommands([{ op: "wait", seconds: "1" }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(withCommands([{ op: "wait", seconds: 1, skipable: "yes" }])),
    ).toThrow(StoryFormatError);
    expect(() => parseStory(withCommands([{ op: "pause" }]))).toThrow(
      StoryFormatError,
    );
  });

  it("while 缺 cond/body 拒绝；body 内坏命令递归拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "while", cond: "{true}" }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(
        withCommands([{ op: "while", cond: "{true}", body: [{ op: "say" }] }]),
      ),
    ).toThrow(StoryFormatError);
  });

  it("for/foreach 缺 var/集合 拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "for", var: "x", body: [] }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(withCommands([{ op: "foreach", var: "x", body: [] }])),
    ).toThrow(StoryFormatError);
  });

  it("switch 缺 on/cases、case 缺 value/body 拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "switch", cases: [] }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(
        withCommands([{ op: "switch", on: "{x}", cases: [{ body: [] }] }]),
      ),
    ).toThrow(StoryFormatError);
  });

  it("array 缺 items、dict value 非对象、dict_set 缺 field 拒绝", () => {
    expect(() => parseStory(withCommands([{ op: "array", key: "a" }]))).toThrow(
      StoryFormatError,
    );
    expect(() =>
      parseStory(withCommands([{ op: "dict", key: "d", value: [1] }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(withCommands([{ op: "dict_set", key: "d", value: 1 }])),
    ).toThrow(StoryFormatError);
  });

  it("func 缺 name/params/body 拒绝；call 缺 target、args 非数组拒绝", () => {
    expect(() =>
      parseStory(withCommands([{ op: "func", name: "fx", params: [] }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(
        withCommands([{ op: "func", name: "fx", params: [1], body: [] }]),
      ),
    ).toThrow(StoryFormatError);
    expect(() => parseStory(withCommands([{ op: "call", args: [] }]))).toThrow(
      StoryFormatError,
    );
    expect(() =>
      parseStory(withCommands([{ op: "call", target: "fx", args: "no" }])),
    ).toThrow(StoryFormatError);
  });

  it("input 缺 prompt/store 拒绝；options 选项式输入暂未实现（fail-closed）", () => {
    expect(() =>
      parseStory(withCommands([{ op: "input", store: "k" }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(withCommands([{ op: "input", prompt: "p" }])),
    ).toThrow(StoryFormatError);
    expect(() =>
      parseStory(
        withCommands([
          { op: "input", prompt: "p", store: "k", options: ["a"] },
        ]),
      ),
    ).toThrow(StoryFormatError);
  });
});
