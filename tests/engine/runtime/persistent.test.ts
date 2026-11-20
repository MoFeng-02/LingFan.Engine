/**
 * 机器级持久数据（persistent）契约与已读记录回归。
 *
 * 第四持久层独立于偏好/存档/SSOT：机器级游戏事实（已读坐标）跨存档共享，不进快照/存档；
 * hydrate 逐项降级不补默认、损坏隔离不挡启动；删档不清 persistent。
 *
 * 证伪锚：hydrate 补默认键 / seen 进存档载荷 / 损坏抛错挡启动，本册对应例转红。
 */
import { describe, expect, it } from "vitest";
import type { PersistentData, PersistentPort } from "@lingfan-engine/core";
import {
  StoryEngine,
  emptyPersistent,
  hydratePersistent,
  isSeen,
  markSeen,
  mergeSeen,
  parseStory,
} from "@lingfan-engine/core";

class MemoryPersistentPort implements PersistentPort {
  data: PersistentData | null = null;
  writes = 0;
  failLoad = false;
  async load(): Promise<PersistentData | null> {
    if (this.failLoad) throw new Error("读取失败");
    return this.data;
  }
  async save(data: PersistentData): Promise<void> {
    this.writes += 1;
    this.data = data;
  }
}

function storyWithSays() {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "say", text: "第一句" },
          { op: "say", text: "第二句" },
          { op: "say", text: "第三句" },
        ],
      },
    ],
  });
}

describe("hydratePersistent 信任边界（逐项降级不补默认）", () => {
  it("合法 v:1 + seen 原样保留", () => {
    const data = hydratePersistent({ v: 1, seen: { a: [0, 2], b: [1] } });
    expect(data).toEqual({ v: 1, seen: { a: [0, 2], b: [1] } });
  });

  it("空载荷/缺失 seen → 空已读，不伪造", () => {
    expect(hydratePersistent(null)).toEqual({ v: 1, seen: {} });
    expect(hydratePersistent(undefined)).toEqual({ v: 1, seen: {} });
    expect(hydratePersistent({ v: 1 })).toEqual({ v: 1, seen: {} });
  });

  it("版本不认（非 v:1）整体回空", () => {
    expect(hydratePersistent({ v: 2, seen: { a: [0] } })).toEqual({
      v: 1,
      seen: {},
    });
    expect(hydratePersistent({ seen: { a: [0] } })).toEqual({ v: 1, seen: {} });
  });

  it("seen 非法下标剔除、去重升序，合法列保留", () => {
    const data = hydratePersistent({
      v: 1,
      seen: { a: [2, 0, 0, -1, 1.5, "x", 1], b: "not-array", c: [] },
    });
    expect(data.seen.a).toEqual([0, 1, 2]);
    expect(data.seen.b).toBeUndefined();
    expect(data.seen.c).toBeUndefined();
  });

  it("非对象载荷回空不抛错（损坏隔离）", () => {
    expect(hydratePersistent("corrupt")).toEqual({ v: 1, seen: {} });
    expect(hydratePersistent(42)).toEqual({ v: 1, seen: {} });
    expect(hydratePersistent([])).toEqual({ v: 1, seen: {} });
  });
});

describe("seen 纯函数（坐标级，不可变）", () => {
  it("isSeen 命中/未命中", () => {
    const seen = { a: [0, 2] };
    expect(isSeen(seen, { columnId: "a", index: 0 })).toBe(true);
    expect(isSeen(seen, { columnId: "a", index: 1 })).toBe(false);
    expect(isSeen(seen, { columnId: "b", index: 0 })).toBe(false);
  });

  it("markSeen 不可变：新增下标升序，已读原样返回", () => {
    const seen = { a: [0] };
    const next = markSeen(seen, { columnId: "a", index: 2 });
    expect(next.a).toEqual([0, 2]);
    expect(seen.a).toEqual([0]);
    const same = markSeen(next, { columnId: "a", index: 2 });
    expect(same).toBe(next);
  });

  it("mergeSeen 并集（加载竞态内存+落盘都不丢）", () => {
    const merged = mergeSeen({ a: [0, 1] }, { a: [1, 2], b: [0] });
    expect(merged.a).toEqual([0, 1, 2]);
    expect(merged.b).toEqual([0]);
  });

  it("emptyPersistent 独立副本", () => {
    const a = emptyPersistent();
    const b = emptyPersistent();
    a.seen.x = [0];
    expect(b.seen.x).toBeUndefined();
  });
});

describe("引擎 persistent 集成（跨存档共享，不进存档）", () => {
  it("advance 离开 say 记已读；isSeen 读面命中", () => {
    const engine = new StoryEngine(storyWithSays(), {});
    engine.start();
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(false);
    engine.advance();
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(true);
    expect(engine.isSeen({ columnId: "a", index: 1 })).toBe(false);
    engine.dispose();
  });

  it("hydratePersistent 加载端口并合并内存已读（竞态不丢）", async () => {
    const port = new MemoryPersistentPort();
    port.data = { v: 1, seen: { a: [0] } };
    const engine = new StoryEngine(storyWithSays(), { persistentPort: port });
    engine.start();
    engine.advance(); // 内存记 a:0（与端口同坐标）
    engine.advance(); // 内存记 a:1
    await engine.hydratePersistent();
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(true);
    expect(engine.isSeen({ columnId: "a", index: 1 })).toBe(true);
    engine.dispose();
  });

  it("端口读取失败不挡启动（损坏隔离，fail 诊断）", async () => {
    const port = new MemoryPersistentPort();
    port.failLoad = true;
    const engine = new StoryEngine(storyWithSays(), { persistentPort: port });
    engine.start();
    await engine.hydratePersistent();
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(false);
    engine.advance();
    expect(engine.isSeen({ columnId: "a", index: 0 })).toBe(true);
    engine.dispose();
  });

  it("已读跨存档共享：换档不清已读（机器级）", async () => {
    const port = new MemoryPersistentPort();
    const engine = new StoryEngine(storyWithSays(), { persistentPort: port });
    engine.start();
    engine.advance();
    await new Promise((r) => setTimeout(r, 0));
    expect(port.data?.seen.a).toContain(0);
    // 已读不在存档载荷：另起引擎读档不应带走/清掉机器级已读
    const engine2 = new StoryEngine(storyWithSays(), { persistentPort: port });
    engine2.start();
    await engine2.hydratePersistent();
    expect(engine2.isSeen({ columnId: "a", index: 0 })).toBe(true);
    engine.dispose();
    engine2.dispose();
  });
});
