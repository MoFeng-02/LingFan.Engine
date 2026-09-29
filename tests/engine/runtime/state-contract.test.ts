/**
 * T08-07 / D-42 写入契约守卫测试（值 + 键）。锚点：`state-value-contract`、`state-key-namespace`。
 *
 * 契约（⚖️ R8 组合式）：
 * - **写入时**（`setGlobal`/`setSystem`，一切程序化写入的收口）：值必须 JSON 安全——
 *   O(1) 白名单（标量/普通对象/数组；拒 undefined 值/function/symbol/bigint/Date/Map/Set/类实例/
 *   非有限数）+ 对**新写入值本身**深走查（循环引用只能在写入点廉价捕获，带键名定位）；
 *   键命中 `RESERVED_STATE_KEYS`（SYS 精确名全集）→ `reserved-key`。
 * - **序列化边界**（`exportSave`）：全量深校验兜「写后原地改」——写时复制挡不住作者拿到引用后
 *   原地改值（R8：作者行为，序列化边界兜底 + 契约条款 + 断言工具；快照期**不做**硬门禁）。
 *
 * 拒绝语义 = `engine.error` + **状态原样**（与 `instance-z-invalid` 同款 fail-closed）。
 *
 * ⚠️ 裁定锚定（防误伤回归）：**保留键 = 精确键名，不是 `__` 前缀一刀切**——作者自用
 * `__teleport_target`（非 SYS 键）必须继续合法（`engine.test.ts:227` 既有用法）。
 */
import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import {
  RESERVED_STATE_KEYS,
  SYS,
  StoryEngine,
  findJsonValueError,
  jsonUnsafeReason,
  parseStory,
} from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  errors: string[];
  messages: string[];
  dispose: () => void;
}

/** 直构（**绕过** parseStory 深校验）——TS 侧构造故事正是非 JSON 值的真实入口（09 故事源） */
function rawStory(columns: object[], defines?: Record<string, unknown>): Story {
  return { formatVersion: 1, id: "t", entry: "a", columns, defines } as unknown as Story;
}

function makeEngine(story: Story): Harness {
  const engine = new StoryEngine(story);
  const errors: string[] = [];
  const messages: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") {
      errors.push(e.payload.code);
      messages.push(e.payload.message);
    }
  });
  return {
    engine,
    errors,
    messages,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

describe("state-value-contract：写入值必须 JSON 安全", () => {
  const badValues: [string, unknown][] = [
    ["Map", new Map()],
    ["Set", new Set()],
    ["Date", new Date()],
    ["function", () => 1],
    ["bigint", 1n],
    ["symbol", Symbol("x")],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  for (const [name, bad] of badValues) {
    it(`拒绝 ${name}（defines 直构路径）：engine.error + 状态原样`, () => {
      const h = makeEngine(
        rawStory([column("a", [{ op: "say", text: "一" }])], { gold: bad }),
      );
      h.engine.start();
      expect(h.errors).toContain("value-not-serializable");
      expect(h.engine.get("gold")).toBeUndefined(); // 状态原样：写入被整体拒绝
      h.dispose();
    });
  }

  it("嵌套非法值带定位：cfg.items[1].x", () => {
    const h = makeEngine(
      rawStory([column("a", [{ op: "say", text: "一" }])], {
        cfg: { items: [1, { x: new Date() }] },
      }),
    );
    h.engine.start();
    expect(h.errors).toContain("value-not-serializable");
    expect(
      h.messages.some((m) => m.includes("cfg.items[1].x")),
      h.messages.join(" | "),
    ).toBe(true);
    h.dispose();
  });

  it("循环引用在写入点被拒（带定位 + 状态原样），不拖到写档才炸", () => {
    const cfg: Record<string, unknown> = { name: "a" };
    cfg.self = cfg; // 自引用
    const h = makeEngine(
      rawStory([column("a", [{ op: "say", text: "一" }])], { cfg }),
    );
    h.engine.start();
    expect(h.errors).toContain("value-not-serializable");
    expect(h.messages.some((m) => m.includes("cfg.self：循环引用"))).toBe(true);
    expect(h.engine.get("cfg")).toBeUndefined();
    h.dispose();
  });

  it("共享引用（别名）不是循环：两个键指向同一数组 → 写入成功、存档正常", () => {
    const shared = [1, 2];
    const h = makeEngine(
      rawStory(
        [
          column("a", [
            { op: "say", text: "一" },
            { op: "wait", seconds: 0.01 },
          ]),
        ],
        { a: shared, b: shared },
      ),
    );
    h.engine.start();
    expect(h.errors).toEqual([]);
    expect(h.engine.get("b")).toBe(shared);
    expect(h.engine.exportSave()).not.toBeNull(); // JSON.stringify 对共享引用无碍
    h.dispose();
  });

  it("合法值全量回归：标量 / null / 普通对象 / 数组 / 嵌套全部可写", () => {
    const ok = {
      s: "文",
      n: 1.5,
      b: false,
      z: null,
      obj: { deep: { list: [1, "x", true, null] } },
      arr: [{ k: 1 }, [2, 3]],
    };
    const h = makeEngine(
      rawStory([column("a", [{ op: "say", text: "一" }])], ok as Record<string, unknown>),
    );
    h.engine.start();
    expect(h.errors).toEqual([]);
    for (const key of Object.keys(ok)) {
      expect(h.engine.get(key)).toEqual((ok as Record<string, unknown>)[key]);
    }
    h.dispose();
  });

  it("对象成员的 undefined/function = JSON 会丢弃该键 → 放行；数组元素 undefined → 会变形为 null → 拒", () => {
    expect(findJsonValueError({ a: undefined }, "root")).toBeNull();
    expect(findJsonValueError({ a: () => 1 }, "root")).toBeNull();
    expect(findJsonValueError([undefined], "root")).not.toBeNull();
    expect(findJsonValueError([() => 1], "root")).not.toBeNull();
  });
});

describe("state-key-namespace：保留键 = SYS 精确名全集", () => {
  it("作者 set 保留键 __waiting → reserved-key（写入被拒，不污染等待状态机）", () => {
    const h = makeEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          column("a", [
            // say 是等待点会暂停推进，必须放在 say **之前**才能真正执行到
            { op: "set", key: "__waiting", value: "none" },
            { op: "notify", text: "x" },
          ]),
        ],
      }),
    );
    h.engine.start();
    expect(h.errors).toContain("reserved-key");
    h.dispose();
  });

  it("define 保留键同样拒绝（同一收口）；引擎初始化的 SYS.elements 不受影响", () => {
    const h = makeEngine(
      rawStory([column("a", [{ op: "notify", text: "x" }])], {
        __elements: "fake",
      }),
    );
    h.engine.start();
    expect(h.errors).toContain("reserved-key");
    expect(h.engine.get(SYS.elements)).not.toBe("fake");
    h.dispose();
  });

  it("⚠️ 回归锚定：作者自用 __teleport_target（非 SYS 键）仍合法——精确键名，非前缀一刀切", () => {
    const h = makeEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          column("a", [
            { op: "set", key: "__teleport_target", value: "inn" },
            { op: "say", text: "一" },
          ]),
        ],
      }),
    );
    h.engine.start();
    expect(h.errors).toEqual([]);
    expect(h.engine.get("__teleport_target")).toBe("inn");
    h.dispose();
  });

  it("保留键集合来自 SYS 全集（精确名）且非空", () => {
    expect(RESERVED_STATE_KEYS.has("__waiting")).toBe(true);
    expect(RESERVED_STATE_KEYS.has("__elements")).toBe(true);
    expect(RESERVED_STATE_KEYS.has("__teleport_target")).toBe(false);
    expect(RESERVED_STATE_KEYS.has("gold")).toBe(false);
  });
});

describe("序列化边界：exportSave 全量深校验（兜「写后原地改」）", () => {
  it("写入后原地改出循环引用 → exportSave 返回 null + value-not-serializable（带定位）", () => {
    // defines 直构：持有**写入值的同一引用**（TS 侧构造的真实入口），先合法写入
    const cfg: Record<string, unknown> = { name: "a" };
    const h = makeEngine(
      rawStory(
        [column("a", [{ op: "say", text: "停在等待点" }])],
        { cfg },
      ),
    );
    h.engine.start();
    expect(h.errors).toEqual([]);
    expect(h.engine.get("cfg")).toBe(cfg); // 同一引用
    // 模拟作者侧原地改值：写入时契约与写时复制都管不到这一步，只能靠序列化边界拦截
    cfg.self = cfg;
    const data = h.engine.exportSave();
    expect(data).toBeNull();
    expect(h.errors).toContain("value-not-serializable");
    expect(h.messages.some((m) => m.includes("cfg.self：循环引用"))).toBe(true);
    h.dispose();
  });
});

describe("白名单单测（jsonUnsafeReason）", () => {
  it("合法 → null；非法 → 原因短语", () => {
    expect(jsonUnsafeReason("s")).toBeNull();
    expect(jsonUnsafeReason(1)).toBeNull();
    expect(jsonUnsafeReason(true)).toBeNull();
    expect(jsonUnsafeReason(null)).toBeNull();
    expect(jsonUnsafeReason({})).toBeNull();
    expect(jsonUnsafeReason([])).toBeNull();
    expect(jsonUnsafeReason(Object.create(null))).toBeNull();
    expect(jsonUnsafeReason(undefined)).not.toBeNull();
    expect(jsonUnsafeReason(() => 1)).not.toBeNull();
    expect(jsonUnsafeReason(Symbol("s"))).not.toBeNull();
    expect(jsonUnsafeReason(1n)).not.toBeNull();
    expect(jsonUnsafeReason(Number.NaN)).not.toBeNull();
    expect(jsonUnsafeReason(new Map())).not.toBeNull();
    expect(jsonUnsafeReason(new Set())).not.toBeNull();
    expect(jsonUnsafeReason(new Date())).not.toBeNull();
    expect(jsonUnsafeReason(/re/)).not.toBeNull();
    expect(jsonUnsafeReason(new (class X {})())).not.toBeNull();
  });
});
