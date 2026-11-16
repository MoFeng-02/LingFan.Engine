/**
 * 列身体随存档往返测试。
 *
 * 语义要点：
 * - `SYS.body` 就是普通状态键，存档整表带走、读档整表换回——零特判
 * - 在身体列的对话中间存档，读档后仍是同一列、同一个身体
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

function makeEngine(): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      defines: { visits: 0 },
      columns: [
        {
          id: "a",
          kind: "scene",
          body: { name: "kitchen", props: { title: "厨房" } },
          entry: [{ op: "say", text: "厨房里" }],
        },
        {
          id: "b",
          kind: "scene",
          body: { name: "hall" },
          entry: [{ op: "say", text: "门厅里" }],
        },
      ],
    }),
  );
}

describe("SYS.body · 存档往返", () => {
  it("身体列存档里带 SYS.body，读档后身体一致", () => {
    const engine = makeEngine();
    engine.start();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    const entry = save!.state.find(([key]) => key === SYS.body);
    expect(entry?.[1]).toEqual({
      name: "kitchen",
      props: { title: "厨房" },
    });

    // 换到另一列（身体被换成 hall），再读回存档
    engine.advance();
    engine.navigate("b");
    expect((engine.get(SYS.body) as { name: string }).name).toBe("hall");
    expect(engine.importSave(save!)).toBe(true);
    expect(engine.get(SYS.body)).toEqual({
      name: "kitchen",
      props: { title: "厨房" },
    });
  });

  it("无身体的列存档里没有该键，读档后键仍不存在", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "a",
            kind: "scene",
            elements: [{ type: "text", id: "t", text: "空房间" }],
            entry: [{ op: "say", text: "什么都没有" }],
          },
        ],
      }),
    );
    engine.start();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    expect(save!.state.map(([key]) => key)).not.toContain(SYS.body);

    engine.advance();
    engine.importSave(save!);
    expect(engine.get(SYS.body)).toBeUndefined();
  });

  it("读档回放不重复写身体（同列重进不产生多余变更通知）", () => {
    const engine = makeEngine();
    engine.start();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    engine.advance();
    engine.navigate("b");

    const seen: unknown[] = [];
    engine.onStateChanged((c) => {
      if (c.key === SYS.body) seen.push(c.value);
    });
    engine.importSave(save!);
    // 读档后身体已是存档里的值；重放若再写同形状的值，会留下第二次通知
    expect((engine.get(SYS.body) as { name: string }).name).toBe("kitchen");
    expect(seen.length).toBeLessThanOrEqual(1);
  });
});
