/** 01-数据层测试：结构校验 fail-closed、columnId 唯一（F1）、两类列。 */
import { describe, expect, it } from "vitest";
import { parseStory, StoryFormatError } from "./format";

const validStory = {
  formatVersion: 1,
  id: "demo",
  columns: [
    { id: "start", kind: "flow", commands: [{ op: "say", text: "你好" }] },
  ],
};

describe("parseStory", () => {
  it("合法最小故事解析通过", () => {
    const story = parseStory(validStory);
    expect(story.id).toBe("demo");
    expect(story.columns[0]).toMatchObject({ id: "start", kind: "flow" });
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

  it("flow 列缺 commands 拒绝", () => {
    expect(() =>
      parseStory({ ...validStory, columns: [{ id: "a", kind: "flow" }] }),
    ).toThrow(StoryFormatError);
  });

  it("scene 列缺 elements 拒绝", () => {
    expect(() =>
      parseStory({ ...validStory, columns: [{ id: "a", kind: "scene" }] }),
    ).toThrow(StoryFormatError);
  });

  it("kind 非法拒绝", () => {
    expect(() =>
      parseStory({
        ...validStory,
        columns: [{ id: "a", kind: "plot", commands: [] }],
      }),
    ).toThrow(StoryFormatError);
  });

  it("命令缺非空 op 拒绝", () => {
    const story = {
      ...validStory,
      columns: [{ id: "start", kind: "flow", commands: [{ text: "没有 op" }] }],
    };
    expect(() => parseStory(story)).toThrow(StoryFormatError);
  });
});
