/**
 * 自定义 op 文本投影测试。
 *
 * 测试要点：
 * - **往返深等**：json → dsl → json 深等；嵌套块体里的自定义 op 同样走投影
 *   （generateCommand/generateBody 全链穿参）
 * - **缺省逐字节不变**：不传 projections = 现行为（自定义 op → TextFormatError「暂无文本投影」
 *   / 解析侧「暂不支持」）——既有 text 测试全绿即回归
 * - **投影缺失 = 整次拒绝**：toText/fromText 失败（null/抛出/畸形）→ 带定位拒绝
 * - **容错降级不变**：projectText 把不可投影收集为该行 issue，其余照常
 */
import { describe, expect, it } from "vitest";
import {
  collectTextProjections,
  generateText,
  parseTextStory,
  projectText,
  TextFormatError,
  type OpExtension,
  type Story,
} from "@lingfan/engine";

const diceExtension: OpExtension = {
  id: "dice",
  stateVersion: 1,
  ops: [
    {
      op: "roll_dice",
      exec: () => ({ ok: true }),
      project: {
        toText: (cmd) => `roll_dice sides=${String(cmd.sides)}`,
        fromText: (text) => {
          const m = /^roll_dice\s+sides=(\d+)$/.exec(text);
          return m === null ? null : { op: "roll_dice", sides: Number(m[1]) };
        },
      },
    },
    {
      op: "no_projection_op",
      exec: () => ({ ok: true }), // 未声明 project：文本形态必须整次拒绝
    },
  ],
};

const projections = collectTextProjections([diceExtension]);

function storyWith(commands: object[]): Story {
  return {
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [{ id: "a", kind: "flow", commands }],
  } as Story;
}

describe("自定义 op 文本投影", () => {
  it("json → dsl → json 往返深等", () => {
    const story = storyWith([
      { op: "say", text: "开局" },
      { op: "roll_dice", sides: 6 },
      { op: "say", text: "结果" },
    ]);
    const text = generateText(story, projections);
    expect(text).toContain("roll_dice sides=6");
    const reparsed = parseTextStory(text, "rt", projections);
    expect(reparsed.columns[0]?.commands).toEqual(story.columns[0]?.commands);
  });

  it("嵌套块体里的自定义 op 同样走投影（if 体往返）", () => {
    const story = storyWith([
      {
        op: "if",
        cond: "{lucky}",
        then: [{ op: "roll_dice", sides: 20 }],
      },
    ]);
    const text = generateText(story, projections);
    expect(text).toContain("roll_dice sides=20");
    const reparsed = parseTextStory(text, "rt", projections);
    expect(reparsed.columns[0]?.commands).toEqual(story.columns[0]?.commands);
  });

  it("缺省（无 projections）= 现行为不变：生成/解析都对自定义 op 整次拒绝", () => {
    const story = storyWith([{ op: "roll_dice", sides: 6 }]);
    expect(() => generateText(story)).toThrow(TextFormatError);
    try {
      generateText(story);
    } catch (error) {
      expect((error as TextFormatError).issues[0]).toContain(
        'op "roll_dice" 暂无文本投影',
      );
    }
    expect(() => parseTextStory("label a:\n  roll_dice sides=6\n")).toThrow(
      TextFormatError,
    );
    try {
      parseTextStory("label a:\n  roll_dice sides=6\n");
    } catch (error) {
      expect((error as TextFormatError).issues[0]).toContain("暂不支持");
    }
  });

  it("容错降级口径不变：projectText 无投影器 → 该行 issue + 其余照常；有投影器 → 零 issue", () => {
    const story = storyWith([
      { op: "say", text: "保留" },
      { op: "roll_dice", sides: 6 },
    ]);
    const degraded = projectText(story);
    expect(degraded.issues).toHaveLength(1);
    expect(degraded.issues[0]).toContain("roll_dice");
    expect(degraded.text).toContain('say "保留"'); // 其余照常输出

    const projected = projectText(story, projections);
    expect(projected.issues).toHaveLength(0);
    expect(projected.text).toContain("roll_dice sides=6");
  });

  it("fromText 解析失败 → 整次拒绝且带 sourceName:行号 定位", () => {
    expect(() =>
      parseTextStory(
        'label a:\n  say "x"\n  roll_dice sides=abc\n',
        "bad.story",
        projections,
      ),
    ).toThrow(TextFormatError);
    try {
      parseTextStory(
        'label a:\n  say "x"\n  roll_dice sides=abc\n',
        "bad.story",
        projections,
      );
    } catch (error) {
      const issues = (error as TextFormatError).issues;
      expect(issues[0]).toContain("bad.story:3");
      expect(issues[0]).toContain("解析失败");
    }
  });

  it("fromText 抛出 → 引擎兜底为该行 issue（异常 message 保留）", () => {
    const throwing = collectTextProjections([
      {
        id: "boom",
        stateVersion: 1,
        ops: [
          {
            op: "boom_op",
            exec: () => ({ ok: true }),
            project: {
              toText: () => "boom_op",
               
              fromText: () => {
                throw new Error("投影器炸了");
              },
            },
          },
        ],
      },
    ]);
    expect(() =>
      parseTextStory("label a:\n  boom_op\n", "b.story", throwing),
    ).toThrow(TextFormatError);
    try {
      parseTextStory("label a:\n  boom_op\n", "b.story", throwing);
    } catch (error) {
      expect((error as TextFormatError).issues[0]).toContain("投影器炸了");
    }
  });

  it("toText 返回 null / 抛出 → 生成侧整次拒绝（投影不了的 op 不假装能投影）", () => {
    const nullToText = collectTextProjections([
      {
        id: "nx",
        stateVersion: 1,
        ops: [
          {
            op: "nx_op",
            exec: () => ({ ok: true }),
            project: { toText: () => null },
          },
        ],
      },
    ]);
    expect(() => generateText(storyWith([{ op: "nx_op" }]), nullToText)).toThrow(
      /文本投影失败/,
    );
    const throwToText = collectTextProjections([
      {
        id: "tx",
        stateVersion: 1,
        ops: [
          {
            op: "tx_op",
            exec: () => ({ ok: true }),
             
            project: {
               
              toText: () => {
                throw new Error("toText 炸了");
              },
            },
          },
        ],
      },
    ]);
    expect(() => generateText(storyWith([{ op: "tx_op" }]), throwToText)).toThrow(
      TextFormatError,
    );
  });

  it("collectTextProjections：只聚合声明了 project 的 op", () => {
    expect(projections.has("roll_dice")).toBe(true);
    expect(projections.has("no_projection_op")).toBe(false);
    expect(collectTextProjections([]).size).toBe(0);
  });
});
