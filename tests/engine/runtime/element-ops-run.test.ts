/**
 * 元素动作序列（`ops` 属性的执行面）测试。
 *
 * 语义要点：
 * - 复用既有 op 分发表（零新语义）；等待/位置/存档类 op 整次拒绝
 * - **不建检查点**：点击是状态变更，不是玩家经历的一步
 * - **原子性**：任一 op 失败 ⇒ 状态与作用域回滚到点击前（拒绝后状态原样）
 * - 只在等待期生效（与正在推进的命令流不交叉）
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

/** 构造一个停在对话等待的引擎（元素动作只在等待期生效） */
function makeEngine(
  entry: object[] = [],
  defines: Record<string, unknown> = {},
): { engine: StoryEngine; errors: OutboundEvent[] } {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      defines,
      columns: [
        {
          id: "s",
          kind: "scene",
          elements: [{ type: "text", id: "title", text: "标题" }],
          entry: [...entry, { op: "say", text: "等待点" }],
        },
      ],
    }),
  );
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => errors.push(e));
  engine.start();
  return { engine, errors };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload.kind === "engine.error" ? e.payload.code : ""));
}

describe("runElementOps · 基本执行", () => {
  it("按序执行并写入状态（复用既有 op 分发表）", () => {
    const { engine, errors } = makeEngine([], { "player.gold": 0 });
    expect(engine.get(SYS.waiting)).toBe("dialog");
    const ok = engine.runElementOps([
      { op: "set", key: "player.gold", value: "+= {10}" },
      { op: "set", key: "flag", value: true },
    ]);
    expect(ok).toBe(true);
    expect(engine.get("player.gold")).toBe(10);
    expect(engine.get("flag")).toBe(true);
    expect(errorCodes(errors)).toEqual([]);
  });

  it("复合赋值基于点击时刻的当前值（顺序执行，非并行）", () => {
    const { engine } = makeEngine([], { "player.gold": 5 });
    engine.runElementOps([
      { op: "set", key: "player.gold", value: "+= {10}" },
      { op: "set", key: "player.gold", value: "+= {10}" },
    ]);
    expect(engine.get("player.gold")).toBe(25);
  });

  it("不改变叙事位置与等待态（点击后仍在原等待点）", () => {
    const { engine } = makeEngine();
    const before = engine.historyCursor();
    engine.runElementOps([{ op: "set", key: "a", value: 1 }]);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.historyCursor()).toBe(before); // 不建检查点
  });
  it("支持任意非等待类内建 op（notify / character / style）", () => {
    const { engine, errors } = makeEngine([
      { op: "character", key: "灵泛", name: "灵泛" },
    ]);
    const ok = engine.runElementOps([
      { op: "notify", text: "点到了", type: "info" },
      { op: "style", target: "title", props: { opacity: 0.5 } },
    ]);
    expect(ok).toBe(true);
    expect(errorCodes(errors)).toEqual([]);
  });
});

describe("runElementOps · 故意错误（fail-closed + 原子回滚）", () => {
  it("等待/位置/存档类 op 整次拒绝，状态零变更", () => {
    const blocked = [
      "say",
      "menu",
      "input",
      "wait",
      "pause",
      "nvl",
      "cutscene",
      "minigame",
      "jump",
      "navigate",
      "call",
      "return",
      "load",
      "save",
      "auto_save",
      "save_delete",
    ];
    for (const op of blocked) {
      const { engine, errors } = makeEngine();
      const ok = engine.runElementOps([
        { op: "set", key: "touched", value: true },
        { op },
      ]);
      expect(ok, `${op} 应被拒绝`).toBe(false);
      expect(errorCodes(errors)).toContain("element-ops-blocked-op");
      // 原子性：前置的 set 也不得留下（整次拒绝）
      expect(engine.get("touched"), `${op} 拒绝后状态应原样`).toBeUndefined();
    }
  });

  it("畸形负载整次拒绝且状态原样", () => {
    for (const bad of [
      [],
      null,
      "not-array",
      [1],
      [{ op: "" }],
      [{ noOp: true }],
    ]) {
      const { engine, errors } = makeEngine();
      const ok = engine.runElementOps(
        bad as unknown as readonly Record<string, unknown>[],
      );
      expect(ok, `${JSON.stringify(bad)} 应被拒绝`).toBe(false);
      expect(
        errorCodes(errors).some(
          (c) => c === "element-ops-invalid" || c === "element-ops-blocked-op",
        ),
      ).toBe(true);
    }
  });

  it("执行失败原子回滚：SSOT 与作用域都回到点击前，不半执行", () => {
    const { engine, errors } = makeEngine([], { "player.gold": 7 });
    const ok = engine.runElementOps([
      { op: "set", key: "player.gold", value: "+= {100}" }, // 先成功
      { op: "set", key: "player.gold", value: "+= {不是数字}" }, // 后失败（表达式错）
    ]);
    expect(ok).toBe(false);
    expect(errorCodes(errors).length).toBeGreaterThan(0);
    // 第一步的写入必须被回滚（否则就是「半执行」）
    expect(engine.get("player.gold")).toBe(7);
  });

  it("无等待画面时拒绝（不与正在推进的命令流交叉）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [{ id: "s", kind: "flow", commands: [{ op: "set", key: "a", value: 1 }] }],
      }),
    );
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    engine.start(); // 脚本跑完（无等待）
    const ok = engine.runElementOps([{ op: "set", key: "b", value: 2 }]);
    expect(ok).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-invalid");
    expect(engine.get("b")).toBeUndefined();
  });

  it("未启动时拒绝", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [{ id: "s", kind: "flow", commands: [{ op: "say", text: "x" }] }],
      }),
    );
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    expect(engine.runElementOps([{ op: "set", key: "a", value: 1 }])).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-invalid");
  });

  it("未知 op 走既有分发 fail-closed（复用既有语义，不新增规则）", () => {
    const { engine, errors } = makeEngine();
    const ok = engine.runElementOps([{ op: "不存在的op" }]);
    expect(ok).toBe(false);
    expect(errorCodes(errors).length).toBeGreaterThan(0);
  });
});

describe("runElementOps · 边界与不变量", () => {
  it("作用域：let 声明不泄漏到点击后的外层帧", () => {
    const { engine } = makeEngine();
    engine.runElementOps([
      { op: "let", key: "临时", value: 1 },
      { op: "set", key: "持久", value: 2 },
    ]);
    expect(engine.get("持久")).toBe(2);
    // let 声明在动作序列的块级作用域内，出帧即销毁（不污染外层）
    expect(engine.get("临时")).toBeUndefined();
  });

  it("混沌：随机混合动作序列后引擎不变量成立（等待态合法 / 坐标有效 / 零抛异常）", () => {
    const { engine, errors } = makeEngine([], { counter: 0 });
    // 种子化伪随机（确定性：同种子同序列）
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 60; round += 1) {
      const pick = next() % 4;
      const ops =
        pick === 0
          ? [{ op: "set", key: "counter", value: "+= {1}" }]
          : pick === 1
            ? [{ op: "notify", text: "n" }]
            : pick === 2
              ? [{ op: "set", key: "counter", value: "+= {坏}" }] // 失败路径
              : [];
      engine.runElementOps(ops as readonly Record<string, unknown>[]);
      // 不变量：等待态仍在对话、历史游标合法（首句尚未提交检查点时为 -1）、公开查询零抛
      expect(engine.get(SYS.waiting)).toBe("dialog");
      expect(engine.historyCursor()).toBeGreaterThanOrEqual(-1);
      expect(() => engine.elements()).not.toThrow();
    }
    // 失败轮次不回滚成功轮次（counter 单调）
    expect(engine.get("counter")).toBeGreaterThan(0);
    expect(errorCodes(errors).length).toBeGreaterThan(0);
  });

  it("重复执行幂等性仅取决于 op 语义（set 覆盖 / += 累加各自正确）", () => {
    const { engine } = makeEngine();
    engine.runElementOps([{ op: "set", key: "k", value: 1 }]);
    engine.runElementOps([{ op: "set", key: "k", value: 1 }]);
    expect(engine.get("k")).toBe(1); // set 覆盖
    engine.runElementOps([{ op: "set", key: "k", value: "+= {1}" }]);
    engine.runElementOps([{ op: "set", key: "k", value: "+= {1}" }]);
    expect(engine.get("k")).toBe(3); // += 累加
  });
});

describe("runElementOps · 与回溯的配合", () => {
  it("点击变更随下一次检查点入档；回溯到更早检查点回到点击前的值", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        defines: { gold: 0 },
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [
              { op: "say", text: "第一句" },
              { op: "say", text: "第二句" },
              { op: "say", text: "第三句" },
            ],
          },
        ],
      }),
    );
    engine.start();
    // 推进到第二句 ⇒ 第一句提交为检查点（此时 gold=0）
    engine.advance();
    engine.advance();
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get("gold")).toBe(0);
    const checkpointAfterFirst = engine.historyCursor();
    // 在第二句等待点点击加钱（不建检查点）
    engine.runElementOps([{ op: "set", key: "gold", value: 50 }]);
    expect(engine.get("gold")).toBe(50);
    expect(engine.historyCursor()).toBe(checkpointAfterFirst);
    // 推进 ⇒ 第二句提交检查点（gold=50 随之入档）
    engine.advance();
    engine.advance();
    expect(engine.get("gold")).toBe(50);
    // 回溯到「第一句」检查点 ⇒ 回到点击前的值
    engine.back();
    engine.back();
    expect(engine.get("gold")).toBe(0);
  });

  it("失败的动作序列不污染历史（回滚后回溯仍一致）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        defines: { gold: 0 },
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
    engine.onEvent((e) => errors.push(e));
    engine.start();
    engine.advance();
    engine.advance();
    const before = engine.get("gold");
    expect(
      engine.runElementOps([
        { op: "set", key: "gold", value: 999 },
        { op: "set", key: "gold", value: "+= {坏}" },
      ]),
    ).toBe(false);
    // 失败 ⇒ 原子回滚，历史与状态都原样
    expect(engine.get("gold")).toBe(before);
    engine.advance();
    expect(errorCodes(errors).length).toBeGreaterThan(0);
    expect(() => engine.back()).not.toThrow();
    expect(engine.get("gold")).toBe(before);
  });
});
