/**
 * `submitSceneOps`（`mode: "scene"`）执行面测试。
 *
 * 语义要点：
 * - 不要求等待画面：进列那刻没有等待态的纯视觉房间同样能提交
 * - **只拒绝 `load`**：其余 op 全部放行——等待类叠在当前身体上，`call` 不换列，
 *   `jump`/`navigate` 真换列就按新列结算，存档类无画面后果
 * - 失败整份回滚：部分成功的写入也退回，拒绝后状态原样
 * - 不建检查点：提交是状态变更，不是玩家经历的一步
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, StoryCommand } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

/**
 * 对抗性输入的提交口：畸形负载/被拒 op 在运行期要撞上引擎的校验，静态类型上则必须
 * 先在测试里显式越过——否则这些用例根本写不出来。公开契约仍是 `readonly StoryCommand[]`。
 */
function raw(ops: readonly unknown[]): readonly StoryCommand[] {
  return ops as readonly StoryCommand[];
}

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
}

function makeEngine(defines: Record<string, unknown> = {}): Harness {
  // 纯视觉房间：有身体、entry 为空 ⇒ 进列后没有任何等待态。
  // 第二列 `other` 只给「换列」类用例一个落点（同为纯视觉，换过去照样没有等待态）。
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      defines,
      columns: [
        { id: "room", kind: "scene", body: { name: "kitchen" } },
        { id: "other", kind: "scene", body: { name: "hall" } },
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

describe("submitSceneOps · 无等待态可执行", () => {
  it("进列即停在无等待态，仍能执行 set", () => {
    const { engine, errors } = makeEngine({ "player.gold": 0 });
    expect(engine.get(SYS.waiting)).not.toBe("dialog");
    const ok = engine.submitSceneOps([
      { op: "set", key: "player.gold", value: "+= {10}" },
    ]);
    expect(ok).toBe(true);
    expect(engine.get("player.gold")).toBe(10);
    expect(errorCodes(errors)).toEqual([]);
  });

  it("按序执行多条（后面的看得到前面的结果）", () => {
    const { engine } = makeEngine({ n: 1 });
    const ok = engine.submitSceneOps([
      { op: "set", key: "n", value: "+= {1}" },
      { op: "set", key: "n", value: "+= {2}" },
      { op: "set", key: "done", value: true },
    ]);
    expect(ok).toBe(true);
    expect(engine.get("n")).toBe(4);
    expect(engine.get("done")).toBe(true);
  });

  it("不建检查点（historyLength 不变）", () => {
    const { engine } = makeEngine({ flag: false });
    const before = engine.historyLength();
    engine.submitSceneOps([{ op: "set", key: "flag", value: true }]);
    expect(engine.historyLength()).toBe(before);
  });

  it("不改变叙事坐标（提交后仍在同一列）", () => {
    const { engine } = makeEngine();
    const before = engine.columns()[0]!.id;
    engine.submitSceneOps([{ op: "set", key: "x", value: 1 }]);
    expect(engine.columns()[0]!.id).toBe(before);
  });

  it("未启动 ⇒ 拒绝且状态原样", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        defines: { a: 0 },
        columns: [{ id: "room", kind: "scene", body: { name: "kitchen" } }],
      }),
    );
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    // 未启动 ⇒ defines 还没垫底，此刻该键本就不存在；提交不得凭空写入
    expect(engine.get("a")).toBeUndefined();
    expect(
      engine.submitSceneOps([{ op: "set", key: "a", value: "+= {1}" }]),
    ).toBe(false);
    expect(engine.get("a")).toBeUndefined();
    expect(errorCodes(errors)).toContain("element-ops-invalid");
  });
});

describe("submitSceneOps · 只拒绝 load", () => {
  it("整次拒绝 load，状态未变（前置校验：前面那条 set 也不执行）", () => {
    const { engine, errors } = makeEngine({ touched: false });
    const ok = engine.submitSceneOps(
      raw([
        { op: "set", key: "touched", value: true },
        { op: "load", slot: "1" },
      ]),
    );
    expect(ok).toBe(false);
    expect(engine.get("touched")).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-blocked-op");
  });

  it("空存档槽的 load 仍走同一拒绝口径（不靠下层失败兜底）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps([{ op: "load", slot: "空的槽" }])).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-blocked-op");
  });
});

describe("submitSceneOps · 除 load 外全部放行", () => {
  it("wait 允许：进入等待态，画面仍是本列身体", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps([{ op: "wait", seconds: 30 }])).toBe(true);
    expect(engine.get(SYS.waiting)).toBe("wait");
    expect(engine.get(SYS.body)).toEqual({ name: "kitchen" });
    expect(errorCodes(errors)).toEqual([]);
  });

  it("menu 允许：等到玩家选择", () => {
    const { engine, errors } = makeEngine();
    const ok = engine.submitSceneOps(
      raw([{ op: "menu", options: [{ text: "选项甲", target: "room" }] }]),
    );
    expect(ok).toBe(true);
    expect(engine.get(SYS.waiting)).toBe("menu");
    expect(errorCodes(errors)).toEqual([]);
  });

  it("input 允许：等到玩家输入", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps(raw([{ op: "input", key: "名字" }]))).toBe(
      true,
    );
    expect(engine.get(SYS.waiting)).toBe("input");
    expect(errorCodes(errors)).toEqual([]);
  });

  it("auto_save 允许：只是改开关，不改画面", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps([{ op: "auto_save", enabled: true }])).toBe(
      true,
    );
    expect(engine.get(SYS.body)).toEqual({ name: "kitchen" });
    expect(errorCodes(errors)).toEqual([]);
  });

  it("jump 允许：真换列 ⇒ 画面与坐标按新列结算", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps([{ op: "jump", target: "other" }])).toBe(true);
    expect(engine.get(SYS.currentSceneColumn)).toBe("other");
    expect(engine.get(SYS.body)).toEqual({ name: "hall" });
    expect(errorCodes(errors)).toEqual([]);
  });

  it("navigate 允许：同上，只是清对话镜像的那条路", () => {
    const { engine, errors } = makeEngine();
    expect(
      engine.submitSceneOps(raw([{ op: "navigate", path: "other" }])),
    ).toBe(true);
    expect(engine.get(SYS.currentSceneColumn)).toBe("other");
    expect(errorCodes(errors)).toEqual([]);
  });

  it("save 不再被前置拒绝（无存档端口时由存档层报 save-unavailable）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps(raw([{ op: "save", slot: "1" }]))).toBe(false);
    expect(errorCodes(errors)).not.toContain("element-ops-blocked-op");
    expect(errorCodes(errors)).toContain("save-unavailable");
  });
});

describe("submitSceneOps · 拒绝畸形负载（非对象 / 缺 op / 空数组）", () => {
  it("畸形负载统一报 element-ops-invalid", () => {
    const { engine, errors } = makeEngine();
    expect(engine.submitSceneOps([])).toBe(false);
    expect(engine.submitSceneOps(raw([1]))).toBe(false);
    expect(engine.submitSceneOps(raw([{ noOp: true }]))).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-invalid");
  });
});

describe("submitSceneOps · 失败整份回滚", () => {
  it("后面的 op 报错 ⇒ 前面已写的也退回", () => {
    const { engine, errors } = makeEngine({ a: 0 });
    const ok = engine.submitSceneOps([
      { op: "set", key: "a", value: 100 },
      { op: "definitely_not_an_op" },
    ]);
    expect(ok).toBe(false);
    expect(engine.get("a")).toBe(0);
    expect(errorCodes(errors)).toContain("unknown-op");
  });

  it("值不可序列化 ⇒ 整份回滚", () => {
    const { engine } = makeEngine({ a: 0 });
    const ok = engine.submitSceneOps([
      { op: "set", key: "a", value: 100 },
      { op: "set", key: "bad", value: { nested: Number.NaN } },
    ]);
    expect(ok).toBe(false);
    expect(engine.get("a")).toBe(0);
    expect(engine.get("bad")).toBeUndefined();
  });

  it("失败后不污染历史", () => {
    const { engine } = makeEngine({ a: 0 });
    const before = engine.historyLength();
    engine.submitSceneOps([{ op: "set", key: "a", value: 1 }, { op: "nope" }]);
    expect(engine.historyLength()).toBe(before);
  });
});

describe("submitSceneOps · 与 runElementOps 的边界", () => {
  it("runElementOps 在没有等待画面时仍被拒（既有裁定不变）", () => {
    const { engine, errors } = makeEngine({ a: 0 });
    expect(engine.runElementOps([{ op: "set", key: "a", value: 1 }])).toBe(
      false,
    );
    expect(engine.get("a")).toBe(0);
    expect(errorCodes(errors)).toContain("element-ops-invalid");
  });

  it("runElementOps 仍拒绝 say（不扩大既有裁定）", () => {
    const { engine, errors } = makeEngine();
    expect(engine.runElementOps([{ op: "say", text: "不该执行" }])).toBe(false);
    expect(errorCodes(errors)).toContain("element-ops-blocked-op");
  });
});
