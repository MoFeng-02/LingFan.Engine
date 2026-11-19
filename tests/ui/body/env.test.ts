/**
 * 身体环境 `createSceneEnv`：组件拿到的读写面是不是引擎那一份，且只开放该开放的。
 *
 * 判据对着「组件会不会绕过宿主直接摸引擎」写：读面必须与引擎查询一致，写面只落
 * `game.<systemId>.<key>`，提交走场景提交入口（`load` 这类存档动作整批拒）。
 * 用真引擎——这些转发只有对着真实状态才有意义，替身会把「转错了键」这类错藏起来。
 */
import { describe, expect, it, vi } from "vitest";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";
import { createSceneEnv, type SceneStageState } from "@lingfan-engine/ui";

const STAGE: SceneStageState = {
  viewport: { width: 800, height: 600 },
  layout: {
    policy: "min",
    scaleX: 1,
    scaleY: 1,
    width: 800,
    height: 600,
    scaledWidth: 800,
    scaledHeight: 600,
    offsetX: 0,
    offsetY: 0,
  },
};

function makeEngine(): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        { id: "room", kind: "scene", body: { name: "room" } },
        {
          id: "talk",
          kind: "flow",
          commands: [{ op: "say", speaker: "甲", text: "你好" }],
        },
      ],
    }),
  );
}

describe("createSceneEnv：读面与引擎同一份", () => {
  it("get / state.get 读同一个键", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.get(SYS.body)).toEqual(engine.get(SYS.body));
    expect(env.state.get(SYS.body)).toEqual(engine.get(SYS.body));
  });

  it("state.getScoped 走作用域键，组件不必知道键怎么拼", () => {
    const engine = makeEngine();
    engine.start();
    engine.gameState.setScoped("world", "lamp", 1);
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.state.getScoped("world", "lamp")).toBe(1);
  });

  it("currentColumn 进列后是列 id；尚未进列交空串", () => {
    const engine = makeEngine();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.currentColumn()).toBe("");
    engine.start();
    expect(env.currentColumn()).toBe("room");
    engine.navigate("talk");
    expect(env.currentColumn()).toBe("talk");
  });

  it("columns / historyLength / historyCursor / interpolate 原样转发", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.columns()).toEqual(engine.columns());
    expect(env.historyLength()).toBe(engine.historyLength());
    expect(env.historyCursor()).toBe(engine.historyCursor());
    expect(env.interpolate("1")).toBe(engine.interpolate("1"));
  });

  it("stage() 交回宿主当次读数（组件不自量尺寸）", () => {
    const engine = makeEngine();
    const readStage = vi.fn(() => STAGE);
    const env = createSceneEnv({ getEngine: () => engine, readStage });
    expect(env.stage()).toBe(STAGE);
    expect(readStage).toHaveBeenCalledTimes(1);
  });
});

describe("createSceneEnv：写面只开放玩法命名空间", () => {
  it("write 落 game.<systemId>.<key>，引擎读得到", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.write("world", "lamp", 1)).toBe(true);
    expect(engine.get("game.world.lamp")).toBe(1);
  });

  it("writeSilent 同样落键，但不产生变更事件", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    const changes: string[] = [];
    engine.onStateChanged((change) => changes.push(change.key));
    expect(env.writeSilent("world", "lamp", 2)).toBe(true);
    expect(engine.get("game.world.lamp")).toBe(2);
    expect(changes).not.toContain("game.world.lamp");
  });

  it("onChange 收窄成无参回调：引擎一变就通知，不带状态明细", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    const listener = vi.fn();
    const stop = env.onChange(listener);
    engine.gameState.setScoped("world", "lamp", 1);
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0]).toEqual([]);
    stop();
    listener.mockClear();
    engine.gameState.setScoped("world", "lamp", 2);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createSceneEnv：提交走场景入口，存档动作整批拒", () => {
  it("submit 一条 say 生效（玩家可见事实落引擎状态）", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.submit([{ op: "say", text: "组件说的话" }])).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("组件说的话");
  });

  it("submit 含 load 整批拒：返回 false 且状态原样", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    const before = engine.get(SYS.currentDialogText);
    expect(
      env.submit([
        { op: "say", text: "先说一句" },
        { op: "load", slot: "s1" },
      ]),
    ).toBe(false);
    // 整份回滚：连前面那条 say 也不生效
    expect(engine.get(SYS.currentDialogText)).toBe(before);
  });

  it("call 转发成一条 call 提交", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    expect(env.call("talk")).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("你好");
  });

  it("navigate 换列", () => {
    const engine = makeEngine();
    engine.start();
    const env = createSceneEnv({
      getEngine: () => engine,
      readStage: () => STAGE,
    });
    env.navigate("talk");
    expect(env.currentColumn()).toBe("talk");
  });
});
