/**
 * 「换列但画面不换」：对话列声明与房间列相同的 `body`，用 `navigate` 进出。
 *
 * 这是「逐句可回退」与「画面保持」同时成立的唯一写法：
 * - `submit([say(…)])` 与 `submit([call(对话列)])` 的帧都没有列坐标，`checkpointCoord`
 *   会塌陷到调用者列，整段对话被 `commitCheckpoint` 的同坐标替换压成一格（组件是原子）；
 * - 真列帧才各有坐标，所以必须真的 `enterColumn` 一条列；
 * - 而画面换不换由 `SYS.body` 决定、不由 `columnId` 决定——`loadBody` 的 `sameBody`
 *   对账发现形状没变就完全不写，宿主因此不重挂组件。
 *
 * 这组用例把三条一起锁住，避免后来者把 `loadBody` 的「形状相同不重写」当性能优化删掉。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

const ROOM_BODY = { name: "room", props: { title: "厨房" } };

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  bodyWrites: number;
}

function makeEngine(): Harness {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        { id: "room", kind: "scene", body: ROOM_BODY },
        // 对话列：同一种 body，命令体是两句 say + 一个状态写 + 回房间。
        {
          id: "talk",
          kind: "flow",
          body: ROOM_BODY,
          commands: [
            { op: "say", speaker: "厨娘", text: "第一句" },
            { op: "say", speaker: "厨娘", text: "第二句" },
            { op: "set", key: "game.world.lamp", value: 1 },
            { op: "jump", target: "room" },
          ],
        },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  let bodyWrites = 0;
  engine.onEvent((event) => {
    if (event.payload.kind === "engine.error") errors.push(event);
  });
  engine.onStateChanged((change) => {
    if (change.key === SYS.body) bodyWrites += 1;
  });
  return { engine, errors, bodyWrites };
}

describe("对话列声明同一 body 时的画面连续性", () => {
  it("进对话列不写 SYS.body，也不产生变更事件", () => {
    const { engine, bodyWrites } = makeEngine();
    engine.start();
    const before = engine.get(SYS.body);
    expect(before).toEqual(ROOM_BODY);
    const writesAtStart = bodyWrites;

    engine.navigate("talk");

    expect(engine.get("__current_scene_column")).toBe("talk");
    expect(engine.get(SYS.body)).toEqual(before);
    expect(bodyWrites).toBe(writesAtStart);
  });

  it("对话列里的每句 say 各占一格历史（可逐句回退）", () => {
    const { engine, errors } = makeEngine();
    engine.start();
    engine.navigate("talk");
    const lenAfterEnter = engine.historyLength();

    engine.advance();
    const lenAfterFirst = engine.historyLength();
    engine.advance();
    const lenAfterSecond = engine.historyLength();

    expect(lenAfterFirst).toBe(lenAfterEnter + 1);
    expect(lenAfterSecond).toBe(lenAfterFirst + 1);
    expect(errors).toEqual([]);
  });

  it("back() 逐句退回，且全过程中 SYS.body 不变", () => {
    const { engine, bodyWrites } = makeEngine();
    engine.start();
    engine.navigate("talk");
    engine.advance();
    engine.advance();
    const writesAtEnd = bodyWrites;

    // 第一句、第二句、再一步才回到房间列
    engine.back();
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    expect(engine.get(SYS.body)).toEqual(ROOM_BODY);

    engine.back();
    expect(engine.get(SYS.currentDialogText)).toBe("第一句");
    expect(engine.get(SYS.body)).toEqual(ROOM_BODY);

    expect(bodyWrites).toBe(writesAtEnd);
  });

  it("对话列跑完 jump 回房间：仍不写 SYS.body", () => {
    const { engine, errors, bodyWrites } = makeEngine();
    engine.start();
    engine.navigate("talk");
    const writesAtEnter = bodyWrites;

    // 两句 say 各推进一次；第二次推进尾部顺带跑完 set + jump 回到房间
    engine.advance();
    engine.advance();

    expect(engine.get("__current_scene_column")).toBe("room");
    expect(engine.get(SYS.body)).toEqual(ROOM_BODY);
    expect(engine.get("game.world.lamp")).toBe(1);
    expect(bodyWrites).toBe(writesAtEnter);
    expect(errors).toEqual([]);
  });

  it("body 形状不同时才真的写 SYS.body（对账不是恒等）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "a",
            kind: "scene",
            body: { name: "room", props: { title: "甲" } },
          },
          {
            id: "b",
            kind: "scene",
            body: { name: "room", props: { title: "乙" } },
          },
        ],
      }),
    );
    let writes = 0;
    engine.start();
    engine.onStateChanged((change) => {
      if (change.key === SYS.body) writes += 1;
    });

    engine.navigate("b");

    expect(writes).toBe(1);
    expect(engine.get(SYS.body)).toEqual({
      name: "room",
      props: { title: "乙" },
    });
  });
});
