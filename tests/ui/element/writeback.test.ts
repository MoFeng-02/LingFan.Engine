/**
 * 元素值回写的落点路由：`cmd` → 偏好通道音量 / 玩法系统命名空间。
 *
 * 这一层存在的意义是**把「谁负责落」从元素层剥离**：元素层只上报 `(element, value)`，
 * 落点判定必须有一处唯一实现，否则模板与 playground 会各判一套，作者的同一个
 * `cmd="volume:bgm"` 在两处得到不同结果。
 *
 * 断言分三层：
 * - **解析层**（`parseWritebackTarget`）：`cmd` 形态与白名单，纯函数，边界全在表里；
 * - **路由层**（`routeElementValueChange`）：落到哪个端口、失败时是否上报；
 * - **闸门层**：本模块**不得直写 SSOT**——只经 `setVolume` / `setScoped` 两个既有入口，
 *   源码里出现 `setSystem` / `__` 保留键即违约。
 */
import { describe, expect, it } from "vitest";
import type { ElementInstance } from "@lingfan-engine/core";
import {
  parseWritebackTarget,
  routeElementValueChange,
  type ElementWritebackPorts,
} from "../../../packages/ui/src/element/writeback.ts";
import writebackSource from "../../../packages/ui/src/element/writeback.ts?raw";

/** 造一个元素：只需要 id 与 props 参与判定 */
function element(props: Record<string, unknown>, id = "el"): ElementInstance {
  return { id, type: "slider", props, z: 0, children: [] };
}

/** 记录型端口：把每次调用记下来，`setScoped` 的返回值可控 */
function createPorts(options?: { rejectScoped?: boolean }): {
  ports: ElementWritebackPorts;
  volumes: Array<{ channel: string; value: number }>;
  scoped: Array<{ systemId: string; key: string; value: unknown }>;
  errors: string[];
} {
  const volumes: Array<{ channel: string; value: number }> = [];
  const scoped: Array<{ systemId: string; key: string; value: unknown }> = [];
  const errors: string[] = [];
  return {
    volumes,
    scoped,
    errors,
    ports: {
      setVolume: (channel, value) => {
        volumes.push({ channel, value });
      },
      setScoped: (systemId, key, value) => {
        if (options?.rejectScoped === true) return false;
        scoped.push({ systemId, key, value });
        return true;
      },
      reportError: (message) => {
        errors.push(message);
      },
    },
  };
}

// ---------- ① 解析层 ----------

describe("回写落点解析（cmd 形态）", () => {
  it("四通道音量各自解析到对应通道", () => {
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      expect(parseWritebackTarget({ cmd: `volume:${channel}` })).toEqual({
        kind: "volume",
        channel,
      });
    }
  });

  it("`game.<系统>.<键>` 解析成三段", () => {
    expect(parseWritebackTarget({ cmd: "game.puzzle.score" })).toEqual({
      kind: "game",
      systemId: "puzzle",
      key: "score",
    });
  });

  it("**不认识的通道 / 形态一律 null**（宁可上报也不猜落点）", () => {
    expect(parseWritebackTarget({ cmd: "volume:master" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "volume:" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "volume" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game.puzzle" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game.puzzle.score.extra" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game..score" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game.puzzle." })).toBeNull();
    expect(parseWritebackTarget({ cmd: "history" })).toBeNull();
  });

  it("**系统 id 形态按既有标识符规则校验**（与 minigame / interaction 同域）", () => {
    // 合法：小写开头，其后小写字母 / 数字 / `_` / `-`（`SHORT_ID_PATTERN`）
    expect(parseWritebackTarget({ cmd: "game.my-game.score" })).toEqual({
      kind: "game",
      systemId: "my-game",
      key: "score",
    });
    expect(parseWritebackTarget({ cmd: "game.puzzle_2.score" })).not.toBeNull();
    // 不合法：大写 / 数字开头 / 含空格 / 超长（> 32）
    expect(parseWritebackTarget({ cmd: "game.Puzzle.score" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game.1puzzle.score" })).toBeNull();
    expect(parseWritebackTarget({ cmd: "game.my puzzle.score" })).toBeNull();
    expect(
      parseWritebackTarget({ cmd: `game.${"a".repeat(33)}.score` }),
    ).toBeNull();
  });

  it("`cmd` 缺失 / 非字符串 / 空串一律 null", () => {
    expect(parseWritebackTarget({})).toBeNull();
    expect(parseWritebackTarget({ cmd: 42 })).toBeNull();
    expect(parseWritebackTarget({ cmd: "" })).toBeNull();
    expect(parseWritebackTarget({ cmd: null })).toBeNull();
  });
});

// ---------- ② 路由层 ----------

describe("回写路由（落到哪个端口）", () => {
  it("音量落点 → `setVolume`，不碰 `setScoped`", () => {
    const h = createPorts();
    const ok = routeElementValueChange(
      element({ cmd: "volume:bgm" }),
      0.35,
      h.ports,
    );
    expect(ok).toBe(true);
    expect(h.volumes).toEqual([{ channel: "bgm", value: 0.35 }]);
    expect(h.scoped).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it("玩法系统落点 → `setScoped`，不碰 `setVolume`", () => {
    const h = createPorts();
    const ok = routeElementValueChange(
      element({ cmd: "game.puzzle.score" }),
      12,
      h.ports,
    );
    expect(ok).toBe(true);
    expect(h.scoped).toEqual([{ systemId: "puzzle", key: "score", value: 12 }]);
    expect(h.volumes).toEqual([]);
  });

  it("字符串与布尔值原样透传（不在这里做业务转换）", () => {
    const h = createPorts();
    routeElementValueChange(
      element({ cmd: "game.puzzle.name" }),
      "灵泛",
      h.ports,
    );
    routeElementValueChange(
      element({ cmd: "game.puzzle.flag" }),
      true,
      h.ports,
    );
    expect(h.scoped.map((s) => s.value)).toEqual(["灵泛", true]);
  });

  it("**没有落点 ⇒ 上报并返回 false**（不静默吞掉，状态不动）", () => {
    const h = createPorts();
    const ok = routeElementValueChange(element({ cmd: "history" }), 1, h.ports);
    expect(ok).toBe(false);
    expect(h.volumes).toEqual([]);
    expect(h.scoped).toEqual([]);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain("volume:<通道>");
  });

  it("**音量值非有限数 ⇒ 上报并拒绝**（NaN / Infinity 都不落）", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = createPorts();
      expect(
        routeElementValueChange(element({ cmd: "volume:se" }), bad, h.ports),
      ).toBe(false);
      expect(h.volumes).toEqual([]);
      expect(h.errors).toHaveLength(1);
    }
    // 字符串也不是音量
    const h = createPorts();
    expect(
      routeElementValueChange(element({ cmd: "volume:se" }), "0.5", h.ports),
    ).toBe(false);
    expect(h.volumes).toEqual([]);
  });

  it("**`setScoped` 被引擎拒绝 ⇒ 上报并返回 false**", () => {
    const h = createPorts({ rejectScoped: true });
    const ok = routeElementValueChange(
      element({ cmd: "game.puzzle.score" }),
      1,
      h.ports,
    );
    expect(ok).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0]).toContain("puzzle.score");
  });
});

// ---------- ③ 闸门层（源码互锁） ----------

describe("回写落点只经既有闸门", () => {
  it("**不出现保留键直写**（`setSystem` / `setSilent` 一律不得出现）", () => {
    expect(writebackSource).not.toMatch(/setSystem/);
    expect(writebackSource).not.toMatch(/setSilent/);
    // 也不许自己拼 `__` 前缀绕门卫
    expect(writebackSource).not.toMatch(/"__/);
  });

  it("**落点只有两条出口**（音量走偏好、其余走玩法命名空间）", () => {
    expect(writebackSource).toContain("setVolume");
    expect(writebackSource).toContain("setScoped");
    // 第三类落点若被加进来，这条断言会红——加落点必须先改设计
    expect(writebackSource).not.toMatch(/setGlobal/);
  });
});
