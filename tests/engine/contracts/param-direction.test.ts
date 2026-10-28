/**
 * 参数方向档位的判据：声明表必须与实际写入能力一致。
 *
 * 这张表只声明、不实现——所以它的价值全在「声明错了会红」。
 * 本文件锁三类不变量：
 *   ① 查表语义（精确键 / 最长前缀 / 缺省只读）；
 *   ② 声明与物理闸一致（`readonly` 的键直写必被拒；`two-way` 的键必须有专用接缝）；
 *   ③ 覆盖率（每个 `SYS` 键都登记了方向，新增键忘登记即红）。
 */
import { describe, expect, it } from "vitest";
import {
  PARAM_DIRECTION,
  RESERVED_STATE_KEYS,
  SYS,
  directionOf,
  type ParamDirection,
} from "@lingfan-engine/core";

describe("方向档位：查表语义", () => {
  it("精确键命中，不受前缀规则干扰", () => {
    expect(directionOf(SYS.waiting)).toBe("readonly");
    expect(directionOf(SYS.audioBgm)).toBe("two-way");
  });

  it("命名空间前缀命中（宿主可写的两个域）", () => {
    expect(directionOf("game.walk.x")).toBe("write");
    expect(directionOf("game.")).toBe("write");
    expect(directionOf("preferences.volumes.bgm")).toBe("two-way");
    expect(directionOf("ext.demo.flag")).toBe("write");
  });

  it("最长前缀优先：细分命名空间能覆盖粗粒度默认", () => {
    // 临时造一张两级表验证规则本身（不改真表——真表由下面的覆盖率判据守着）
    const nested: Readonly<Record<string, ParamDirection>> = {
      "game.": "write",
      "game.locked.": "readonly",
    };
    const probe = (key: string): ParamDirection => {
      const exact = nested[key];
      if (exact !== undefined) return exact;
      let best: ParamDirection | undefined;
      let bestLength = 0;
      for (const [pattern, direction] of Object.entries(nested)) {
        if (!pattern.endsWith(".")) continue;
        if (!key.startsWith(pattern)) continue;
        if (pattern.length > bestLength) {
          best = direction;
          bestLength = pattern.length;
        }
      }
      return best ?? "readonly";
    };
    expect(probe("game.walk.x")).toBe("write");
    expect(probe("game.locked.x")).toBe("readonly");
  });

  it("未声明的键一律只读（白名单优于黑名单）", () => {
    expect(directionOf("作者自己的变量")).toBe("readonly");
    expect(directionOf("__author_scratch")).toBe("readonly");
    expect(directionOf("")).toBe("readonly");
  });
});

describe("方向档位：与物理闸一致", () => {
  it("每个 SYS 键都登记了方向（新增键忘登记即红）", () => {
    const undeclared = Object.values(SYS).filter(
      (key) => PARAM_DIRECTION[key] === undefined,
    );
    expect(
      undeclared,
      "这些系统键没登记方向：请在 PARAM_DIRECTION 里显式声明（缺省只读会掩盖真实意图）",
    ).toEqual([]);
  });

  it("声明为 readonly 的系统键，直写必被拒（保留键闸门仍然生效）", () => {
    const readonlyKeys = Object.values(SYS).filter(
      (key) => directionOf(key) === "readonly",
    );
    expect(readonlyKeys.length).toBeGreaterThan(0);
    for (const key of readonlyKeys) {
      expect(RESERVED_STATE_KEYS.has(key), `${key} 应是保留键`).toBe(true);
    }
  });

  it("声明为 two-way 的系统键，都必须是保留键（写权限归专用接缝，不归直写）", () => {
    const twoWayKeys = Object.values(SYS).filter(
      (key) => directionOf(key) === "two-way",
    );
    expect(twoWayKeys.length).toBeGreaterThan(0);
    for (const key of twoWayKeys) {
      expect(
        RESERVED_STATE_KEYS.has(key),
        `${key} 声明 two-way 却不在保留集——意味着可以被直写，绕过了专用接缝`,
      ).toBe(true);
    }
  });

  it("game. 命名空间下不得出现系统键（否则 setScoped 会绕过保留键判定）", () => {
    const systemKeys = new Set<string>(Object.values(SYS));
    for (const key of systemKeys) {
      expect(
        key.startsWith("game."),
        `系统键 ${key} 落在 game. 命名空间下`,
      ).toBe(false);
    }
  });
});

describe("方向档位：三类档位都有实例（表不是空的）", () => {
  it("readonly / write / two-way 三档各至少一个登记项", () => {
    const all = Object.values(PARAM_DIRECTION);
    for (const direction of [
      "readonly",
      "write",
      "two-way",
    ] satisfies ParamDirection[]) {
      expect(
        all.filter((d) => d === direction).length,
        `档位 ${direction} 没有任何登记项——表退化成空壳`,
      ).toBeGreaterThan(0);
    }
  });
});
