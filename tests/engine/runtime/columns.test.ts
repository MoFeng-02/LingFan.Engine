/**
 * **列清单与当前列读数**（宿主侧观察接缝）。
 *
 * 两条接缝合在一组，因为它们必须给出**同一份**答案：
 * - `engine.columns()`：宿主列章节、判当前页、决定跳哪的输入；
 * - `StateReader.currentColumnId()` / `currentColumnType()`：界面每帧要读的当前页。
 *
 * 五件事分别守：
 * 1. 摘要只含三字段（`id` / `type` / `kind`）——多一个字段，宿主就能自己解释命令流；
 * 2. 顺序与项数同 `story.columns`（作者写的顺序就是呈现顺序，不排序不去重）；
 * 3. `type` 已归一（缺省 → `game`；旧拼写 `menu` 归约成 `ui`），宿主不必自己判缺省；
 * 4. 写时复制 + 冻结：宿主改摘要碰不到引擎，改了当场报错而不是静默分叉；
 * 5. 读口对畸形值降级：数值 / 对象 / 列清单缺项都回缺省，不抛。
 */
import { describe, expect, it } from "vitest";
import {
  SYS,
  StoryEngine,
  columnSummaries,
  createStateReader,
  parseStory,
  type ColumnSummary,
  type Story,
} from "@lingfan-engine/core";

// ---------- 夹具 ----------

/**
 * 五列：`flow` 与 `scene` 两种形态 × `game` / `ui` 两种契约值（含缺省与旧拼写别名）。
 *
 * `start` 的菜单指向 `title`，用于验证「进入菜单列后读口跟着变」。
 */
function makeStory(): Story {
  return parseStory({
    formatVersion: 1,
    id: "columns",
    entry: "start",
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "say", text: "开场" },
          {
            op: "menu",
            prompt: "去哪",
            options: [{ text: "标题", target: "title" }],
          },
        ],
      },
      // 界面层：与 `ui` 同义，只是换了个位置标一遍（同名测试覆盖两列都如实透出）
      { id: "title", kind: "flow", type: "ui", commands: [] },
      { id: "popup", kind: "flow", type: "ui", commands: [] },
      { id: "stage", kind: "scene", elements: [], entry: [] },
      { id: "explicit", kind: "flow", type: "game", commands: [] },
    ],
  });
}

/** 期望的摘要表：与夹具逐项对应，顺序即 `story.columns` 顺序 */
const EXPECTED: readonly ColumnSummary[] = [
  { id: "start", type: "game", kind: "flow" },
  { id: "title", type: "ui", kind: "flow" },
  { id: "popup", type: "ui", kind: "flow" },
  { id: "stage", type: "game", kind: "scene" },
  { id: "explicit", type: "game", kind: "flow" },
];

function makeEngine(): StoryEngine {
  return new StoryEngine(makeStory(), { rngSeed: 3 });
}

/** 走到 `start` 的菜单等待点（此后 `choose` 才有效） */
function toMenu(engine: StoryEngine): void {
  engine.start();
  engine.advance();
}

// ---------- ① 摘要形状 ----------

describe("列清单 · 摘要形状（只交宿主用得上的三件事）", () => {
  it("**每项恰好三字段**：`id` / `type` / `kind`", () => {
    const summaries = makeEngine().columns();
    expect(summaries).toHaveLength(EXPECTED.length);
    for (const summary of summaries) {
      expect(Object.keys(summary).sort()).toEqual(["id", "kind", "type"]);
    }
  });

  it("**不含解释输入**：没有 `commands` / `elements` / `entry` / `font`", () => {
    // 宿主拿到 `commands` 就会自己解释一遍，等于在引擎之外再造解释器
    for (const summary of makeEngine().columns()) {
      const keys: readonly string[] = Object.keys(summary);
      for (const leaked of ["commands", "elements", "entry", "font"]) {
        expect(keys).not.toContain(leaked);
      }
    }
  });

  it("`columnSummaries` 是同一个投影的公共入口（宿主可绕过引擎实例直接用）", () => {
    const story = makeStory();
    expect(columnSummaries(story)).toEqual(makeEngine().columns());
  });
});

// ---------- ② 顺序与项数 ----------

describe("列清单 · 顺序与项数（作者顺序即呈现顺序）", () => {
  it("**项数与顺序同 `story.columns`**（不排序、不去重）", () => {
    const story = makeStory();
    const engine = new StoryEngine(story, { rngSeed: 3 });
    expect(engine.columns().map((column) => column.id)).toEqual(
      story.columns.map((column) => column.id),
    );
    expect(engine.columns()).toHaveLength(story.columns.length);
  });

  it("三项内容逐项对齐（`id` / `type` / `kind` 的取值不走样）", () => {
    expect(makeEngine().columns()).toEqual(EXPECTED);
  });

  it("`kind` 原样转达（`scene` 与 `flow` 都照搬）", () => {
    const kinds = makeEngine()
      .columns()
      .map((column) => column.kind);
    expect(kinds).toEqual(["flow", "flow", "flow", "scene", "flow"]);
  });
});

// ---------- ③ type 归一 ----------

describe("列清单 · `type` 归一（缺省 = game）", () => {
  it("**未声明 type ⇒ `game`**（宿主不必自己补缺省）", () => {
    const byId = new Map(
      makeEngine()
        .columns()
        .map((column) => [column.id, column.type]),
    );
    expect(byId.get("start")).toBe("game");
    expect(byId.get("stage")).toBe("game");
  });

  it("显式 `game` 与缺省同值（两种写法对宿主不可区分）", () => {
    const byId = new Map(
      makeEngine()
        .columns()
        .map((column) => [column.id, column.type]),
    );
    expect(byId.get("explicit")).toBe(byId.get("start"));
  });

  it("**`ui` 原样保留**（不被归一成 game）", () => {
    const byId = new Map(
      makeEngine()
        .columns()
        .map((column) => [column.id, column.type]),
    );
    expect(byId.get("title")).toBe("ui");
    expect(byId.get("popup")).toBe("ui");
  });

  it("`type` 与 `kind` 正交：`flow` + `ui` 是纯流程的界面层", () => {
    const title = makeEngine()
      .columns()
      .find((c) => c.id === "title");
    expect(title?.kind).toBe("flow");
    expect(title?.type).toBe("ui");
  });
});

// ---------- ④ 写时复制与冻结 ----------

describe("列清单 · 写时复制与冻结（宿主改不动引擎）", () => {
  it("**每次调用都是新数组**（缓存返回值会跨热重载留旧清单）", () => {
    const engine = makeEngine();
    expect(engine.columns()).not.toBe(engine.columns());
  });

  it("**元素每次都是新对象**（同一份摘要不该被两处共享）", () => {
    const engine = makeEngine();
    const before = engine.columns();
    const after = engine.columns();
    expect(before[0]).not.toBe(after[0]);
    // 内容相同但引用不同：值语义，不是共享句柄
    expect(before[0]).toEqual(after[0]);
  });

  it("**返回项被冻结**（改字段当场抛，不静默分叉）", () => {
    const engine = makeEngine();
    for (const summary of engine.columns()) {
      expect(Object.isFrozen(summary)).toBe(true);
    }
    const first = engine.columns()[0]!;
    expect(() => {
      (first as { type: string }).type = "ui";
    }).toThrow(TypeError);
    // 抛过之后引擎那边的口径没变
    expect(engine.columns()[0]?.type).toBe("game");
  });

  it("**往返回数组里 push 不脏引擎**（下一次调用的清单照旧）", () => {
    const engine = makeEngine();
    const list = engine.columns() as ColumnSummary[];
    const extra: ColumnSummary = { id: "sneaked", type: "ui", kind: "flow" };
    list.push(extra);
    expect(list).toHaveLength(EXPECTED.length + 1);

    const fresh = engine.columns();
    expect(fresh).toHaveLength(EXPECTED.length);
    expect(fresh.map((column) => column.id)).not.toContain("sneaked");
  });

  it("**清空返回数组不脏引擎**（拿到的不是内部那一份）", () => {
    const engine = makeEngine();
    (engine.columns() as ColumnSummary[]).length = 0;
    expect(engine.columns()).toHaveLength(EXPECTED.length);
  });
});

// ---------- ⑤ 读口读当前列 ----------

describe("当前列读数（读口与列清单同源）", () => {
  it("**启动前：id 为空串、type 为 game**（与可回溯判定对启动期的口径一致）", () => {
    const engine = makeEngine();
    const reader = createStateReader(engine);
    expect(reader.currentColumnId()).toBe("");
    expect(reader.currentColumnType()).toBe("game");
  });

  it("进入游戏列后读数跟上故事坐标", () => {
    const engine = makeEngine();
    const reader = createStateReader(engine);
    toMenu(engine);
    expect(reader.currentColumnId()).toBe("start");
    expect(reader.currentColumnId()).toBe(
      String(engine.get(SYS.currentSceneColumn)),
    );
    expect(reader.currentColumnType()).toBe("game");
  });

  it("**进入界面列后 type 为 `ui`**（读口与列清单同口径）", () => {
    const engine = makeEngine();
    const reader = createStateReader(engine);
    toMenu(engine);
    engine.choose("title");
    expect(reader.currentColumnId()).toBe("title");
    expect(reader.currentColumnType()).toBe("ui");
    engine.dispose();
  });

  it("另一列 `ui` 同样如实透出（不是只有某一列特殊）", () => {
    const engine = makeEngine();
    const reader = createStateReader(engine);
    toMenu(engine);
    engine.navigate("popup");
    expect(reader.currentColumnId()).toBe("popup");
    expect(reader.currentColumnType()).toBe("ui");
    engine.dispose();
  });

  it("显式声明 `game` 的列与缺省列读数一致", () => {
    const engine = makeEngine();
    const reader = createStateReader(engine);
    toMenu(engine);
    engine.navigate("explicit");
    expect(reader.currentColumnType()).toBe("game");
    engine.dispose();
  });
});

// ---------- ⑥ 读口降级 ----------

describe("当前列读数 · 降级（畸形值回缺省，不抛）", () => {
  it("**状态源给出数字 / 对象 / null ⇒ id 回空串、type 回 game**", () => {
    for (const broken of [42, { columnId: "title" }, null, true, []] as const) {
      const reader = createStateReader({
        get: (key) => (key === SYS.currentSceneColumn ? broken : undefined),
      });
      expect(() => reader.currentColumnId()).not.toThrow();
      expect(reader.currentColumnId()).toBe("");
      expect(reader.currentColumnType()).toBe("game");
    }
  });

  it("**读口不提供列清单时只能给 game**（它不猜）", () => {
    const reader = createStateReader({ get: () => "title" });
    // id 照实读出：状态里确实是它
    expect(reader.currentColumnId()).toBe("title");
    // 但类型无处可查 ⇒ 缺省，不因为「查不到」抛错
    expect(reader.currentColumnType()).toBe("game");
  });

  it("**列清单里的 type 被改坏 ⇒ 归一为 game**（读口不另判一遍）", () => {
    const reader = createStateReader({
      get: () => "gone",
      columns: () =>
        [
          { id: "gone", type: "cutscene", kind: "flow" },
        ] as unknown as readonly ColumnSummary[],
    });
    expect(reader.currentColumnType()).toBe("game");
  });

  it("**id 已失效（列清单里没有它）⇒ game**（热重载后坐标过期）", () => {
    const reader = createStateReader({
      get: () => "vanished",
      columns: () => makeEngine().columns(),
    });
    expect(reader.currentColumnId()).toBe("vanished");
    expect(reader.currentColumnType()).toBe("game");
  });

  it("空列清单不抛（`columns()` 返回空数组的提供者）", () => {
    const reader = createStateReader({ get: () => "start", columns: () => [] });
    expect(reader.currentColumnType()).toBe("game");
  });
});
