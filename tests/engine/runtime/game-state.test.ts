/**
 * 外部玩法系统状态写入面（`GameStateWriter`）测试。
 *
 * 契约三条（与设计稿一致）：
 * - **状态即接口**：只共享 JSON 键值对，写入即进 SSOT
 * - **写入即入档**：外部写入随快照/存档/回溯随行（本文件验回溯一致性）
 * - **fail-closed**：保留键 / 非法系统标识 / 不可序列化值 ⇒ 拒绝 + 诊断，状态原样
 *
 * 故意错误：循环引用 / 类实例 / NaN / 保留键 / 非法 systemId。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan/engine";
import { SYS, StoryEngine, gameScopedKey, parseStory } from "@lingfan/engine";

function makeEngine(defines: Record<string, unknown> = {}): {
  engine: StoryEngine;
  errors: OutboundEvent[];
  changes: string[];
} {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      defines,
      columns: [
        {
          id: "s",
          kind: "flow",
          commands: [
            { op: "say", text: "第一句" },
            { op: "say", text: "第二句" },
          ],
        },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  const changes: string[] = [];
  engine.onEvent((e) => errors.push(e));
  engine.onStateChanged((c) => changes.push(c.key));
  engine.start();
  return { engine, errors, changes };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload.kind === "engine.error" ? e.payload.code : ""));
}

describe("GameStateWriter · 基本写入（状态即接口）", () => {
  it("set 写全局状态并进事件流（UI 可响应）", () => {
    const { engine, changes } = makeEngine();
    expect(engine.gameState.set("player.gold", 42)).toBe(true);
    expect(engine.get("player.gold")).toBe(42);
    expect(changes).toContain("player.gold");
  });

  it("setSilent 写状态但不进事件流（帧级高频）", () => {
    const { engine, changes } = makeEngine();
    const before = changes.length;
    expect(engine.gameState.setSilent("player.x", 12.5)).toBe(true);
    expect(engine.get("player.x")).toBe(12.5);
    expect(changes.length, "静默写不得增加事件").toBe(before);
  });

  it("setScoped 走 game.<系统>.<键> 命名空间（与作者变量隔离）", () => {
    const { engine, changes } = makeEngine({ "player.gold": 7 });
    expect(engine.gameState.setScoped("walk", "x", 100)).toBe(true);
    expect(engine.get(gameScopedKey("walk", "x"))).toBe(100);
    expect(engine.get("game.walk.x")).toBe(100);
    // 作者变量不受影响（隔离成立）
    expect(engine.get("player.gold")).toBe(7);
    expect(changes).toContain("game.walk.x");
  });

  it("setScopedSilent 是每帧坐标的标准通道（不进事件流）", () => {
    const { engine, changes } = makeEngine();
    const before = changes.length;
    for (let i = 0; i < 60; i += 1) {
      expect(engine.gameState.setScopedSilent("walk", "x", i)).toBe(true);
    }
    expect(engine.get("game.walk.x")).toBe(59);
    expect(changes.length, "60 帧写入不得产生事件（防事件风暴）").toBe(before);
  });

  it("get 读状态（读不到 = undefined，不抛）", () => {
    const { engine } = makeEngine({ "player.gold": 3 });
    expect(engine.gameState.get("player.gold")).toBe(3);
    expect(engine.gameState.get("不存在")).toBeUndefined();
  });

  it("写入复杂 JSON 值（对象/数组/嵌套）", () => {
    const { engine } = makeEngine();
    const bag = { items: [{ id: "potion", n: 2 }], gold: 100 };
    expect(engine.gameState.set("player.bag", bag)).toBe(true);
    expect(engine.gameState.get("player.bag")).toEqual(bag);
  });
});

describe("GameStateWriter · 故意错误（fail-closed，状态原样）", () => {
  it("保留键（SYS 全集）拒绝写入", () => {
    const { engine, errors } = makeEngine();
    expect(engine.gameState.set(SYS.waiting, "hacked")).toBe(false);
    expect(errorCodes(errors)).toContain("reserved-key");
    expect(engine.get(SYS.waiting)).toBe("dialog"); // 等待态未被破坏
  });

  it("非法系统标识拒绝（路径穿越式命名空间污染）", () => {
    const { engine, errors } = makeEngine();
    const bad = ["", "Walk", "带中文", "a b", "../etc", "x".repeat(33), "1abc"];
    for (const id of bad) {
      expect(engine.gameState.setScoped(id, "x", 1), `${id} 应被拒绝`).toBe(false);
    }
    expect(
      errorCodes(errors).filter((c) => c === "game-system-invalid").length,
    ).toBe(bad.length);
  });

  it("不可序列化值拒绝：NaN / 类实例 / 循环引用（带定位）", () => {
    const { engine, errors } = makeEngine();
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const cases: Array<[string, unknown]> = [
      ["player.nan", Number.NaN],
      ["player.inf", Number.POSITIVE_INFINITY],
      ["player.date", new Date()],
      ["player.map", new Map()],
      ["player.cyclic", cyclic],
      ["player.fn", () => 1],
    ];
    for (const [key, value] of cases) {
      expect(engine.gameState.set(key, value), `${key} 应被拒绝`).toBe(false);
      expect(engine.get(key), `${key} 拒绝后状态应原样`).toBeUndefined();
    }
    expect(errorCodes(errors).filter((c) => c === "value-not-serializable").length).toBe(
      cases.length,
    );
    // 循环引用的诊断必须带定位（不然不知道是哪个键）
    const cyclicError = errors.find(
      (e) =>
        e.payload.kind === "engine.error" &&
        e.payload.code === "value-not-serializable" &&
        e.payload.message.includes("循环引用"),
    );
    expect(cyclicError).toBeDefined();
    expect(
      cyclicError!.payload.kind === "engine.error" ? cyclicError!.payload.message : "",
    ).toContain("player.cyclic");
  });

  it("静默通道同样受契约约束（不得因静默就放行非法值）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.gameState.setSilent("player.bad", Number.NaN)).toBe(false);
    expect(engine.gameState.setSilent(SYS.dialogComplete, true)).toBe(false);
    expect(engine.get("player.bad")).toBeUndefined();
    expect(errorCodes(errors).length).toBeGreaterThanOrEqual(2);
  });

  it("对象成员上的 undefined 按 JSON 语义放行（可选字段惯用形态）", () => {
    const { engine } = makeEngine();
    expect(engine.gameState.set("player.opt", { id: 1, name: undefined })).toBe(true);
  });

  it("数组元素上的 undefined 拒绝（JSON 会变形为 null）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.gameState.set("player.arr", [1, undefined, 3])).toBe(false);
    expect(errorCodes(errors)).toContain("value-not-serializable");
  });
});

describe("GameStateWriter · 写入即入档（回溯一致性）", () => {
  it("外部写入随检查点入档；回溯回到写入前的值", () => {
    const { engine } = makeEngine({ "game.walk.x": 0 });
    engine.advance();
    engine.advance();
    // 在第二句等待点：外部系统写坐标（不建检查点）
    expect(engine.gameState.setScopedSilent("walk", "x", 999)).toBe(true);
    expect(engine.get("game.walk.x")).toBe(999);
    // 推进提交检查点
    engine.advance();
    engine.advance();
    // 回溯：坐标应回到写入前的值（外部系统无需自建回滚逻辑）
    engine.back();
    engine.back();
    expect(engine.get("game.walk.x")).toBe(0);
  });

  it("导出存档包含外部写入的状态（状态即接口 ⇒ 序列化免费）", () => {
    const { engine } = makeEngine();
    engine.gameState.setScoped("bag", "items", ["potion"]);
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    const keys = save!.state.map(([k]) => k);
    expect(keys).toContain("game.bag.items");
  });

  it("读档恢复外部状态（含命名空间键）", () => {
    const { engine } = makeEngine();
    engine.gameState.setScoped("walk", "x", 50);
    const save = engine.exportSave()!;
    engine.gameState.setScoped("walk", "x", 0);
    engine.importSave(save);
    expect(engine.get("game.walk.x")).toBe(50);
  });
});

describe("GameStateWriter · 与既有写入面的一致性", () => {
  it("外部写入的值可被故事表达式读取（作者侧 {game.walk.x}）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [{ op: "say", text: "坐标 {game.walk.x}" }],
          },
        ],
      }),
    );
    engine.start();
    engine.gameState.setScopedSilent("walk", "x", 42);
    // 插值读同一张表（状态即接口的直接体现）
    expect(engine.interpolate("{game.walk.x}")).toBe("42");
  });

  it("写入后 set 变量可参与表达式运算（与作者变量同表同语义）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        defines: { "game.battle.hp": 100 },
        columns: [{ id: "s", kind: "flow", commands: [{ op: "say", text: "x" }] }],
      }),
    );
    engine.start();
    engine.gameState.setScoped("battle", "hp", 30);
    expect(engine.interpolate("{game.battle.hp >= 50}")).toBe("false");
  });
});
