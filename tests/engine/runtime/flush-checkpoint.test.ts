/**
 * 检查点补交的「真提交才置位」契约（flush-true-commit-only）。
 *
 * 白盒直测 `commitCheckpoint` / `flushPendingCheckpoint` 的返回值与副作用：
 * - `commitCheckpoint` 返回是否**真的入档**：回退关闭 / 非 game 列（menu/ui 覆盖层）
 *   被守卫丢弃 ⇒ false（历史不增长）；任何一种入档 ⇒ true。
 * - `flushPendingCheckpoint` 据此决定是否置 `liveCheckpointed`：丢弃时**不得置位**
 *   （否则回退误以为当前画面已在历史里）；待提交检查点消费即清，不留半提交残留。
 *
 * 用最小 ctx 替身隔离这两个纯函数（不牵动整台引擎），判据直接读历史/游标/标记。
 */
import { describe, expect, it } from "vitest";
import {
  commitCheckpoint,
  flushPendingCheckpoint,
} from "../../../packages/core/src/runtime/history/snapshot.ts";
import type {
  Checkpoint,
  OpContext,
} from "../../../packages/core/src/runtime/internal/index.ts";

interface Stub {
  rollbackEnabled: boolean;
  history: Checkpoint[];
  cursor: number;
  historyLimit: number;
  pendingSay: Checkpoint | null;
  liveCheckpointed: boolean;
  isCurrentColumnReplayable: () => boolean;
  commitCheckpoint: (cp: Checkpoint) => boolean;
}

function makeCtx(opts: {
  replayable?: boolean;
  rollbackEnabled?: boolean;
  history?: Checkpoint[];
  cursor?: number;
  historyLimit?: number;
}): Stub {
  const stub: Stub = {
    rollbackEnabled: opts.rollbackEnabled ?? true,
    history: opts.history ?? [],
    cursor: opts.cursor ?? -1,
    historyLimit: opts.historyLimit ?? 50,
    pendingSay: null,
    liveCheckpointed: false,
    isCurrentColumnReplayable: () => opts.replayable ?? true,
    commitCheckpoint: () => false,
  };
  stub.commitCheckpoint = (cp) =>
    commitCheckpoint(stub as unknown as OpContext, cp);
  return stub;
}

function cp(columnId: string, index: number): Checkpoint {
  return {
    coord: { columnId, index },
    snapshot: {} as Checkpoint["snapshot"],
  };
}

function flush(stub: Stub): boolean {
  return flushPendingCheckpoint(stub as unknown as OpContext);
}

describe("commitCheckpoint 返回是否真提交（flush-true-commit-only）", () => {
  it("回退关闭 ⇒ false，历史不增长", () => {
    const stub = makeCtx({ rollbackEnabled: false });
    expect(commitCheckpoint(stub as unknown as OpContext, cp("g", 0))).toBe(
      false,
    );
    expect(stub.history).toHaveLength(0);
  });

  it("非 game 列（ui 覆盖层）⇒ false，历史不增长", () => {
    const stub = makeCtx({ replayable: false });
    expect(commitCheckpoint(stub as unknown as OpContext, cp("ui", 0))).toBe(
      false,
    );
    expect(stub.history).toHaveLength(0);
  });

  it("game 列空历史 ⇒ true，入档且游标指向它", () => {
    const stub = makeCtx({});
    expect(commitCheckpoint(stub as unknown as OpContext, cp("g", 0))).toBe(
      true,
    );
    expect(stub.history).toHaveLength(1);
    expect(stub.cursor).toBe(0);
  });

  it("同坐标重取 ⇒ true（原位替换，游标不动）", () => {
    const stub = makeCtx({ history: [cp("g", 0)], cursor: 0 });
    expect(commitCheckpoint(stub as unknown as OpContext, cp("g", 0))).toBe(
      true,
    );
    expect(stub.history).toHaveLength(1);
    expect(stub.cursor).toBe(0);
  });

  it("容量淘汰最旧 ⇒ true（仍是一次真入档）", () => {
    const stub = makeCtx({
      history: [cp("g", 0), cp("g", 1)],
      cursor: 1,
      historyLimit: 2,
    });
    expect(commitCheckpoint(stub as unknown as OpContext, cp("g", 2))).toBe(
      true,
    );
    expect(stub.history).toHaveLength(2);
    expect(stub.history[0]!.coord.index).toBe(1);
    expect(stub.cursor).toBe(1);
  });
});

describe("flushPendingCheckpoint 真提交才置位（flush-true-commit-only）", () => {
  it("无待提交检查点 ⇒ false，标记不动", () => {
    const stub = makeCtx({});
    expect(flush(stub)).toBe(false);
    expect(stub.liveCheckpointed).toBe(false);
  });

  it("ui 列丢弃 ⇒ false，消费即清但**不置** liveCheckpointed", () => {
    const stub = makeCtx({ replayable: false });
    stub.pendingSay = cp("ui", 0);
    expect(flush(stub)).toBe(false);
    expect(stub.pendingSay).toBeNull();
    expect(stub.liveCheckpointed).toBe(false);
    expect(stub.history).toHaveLength(0);
  });

  it("回退关闭丢弃 ⇒ false，不置 liveCheckpointed", () => {
    const stub = makeCtx({ rollbackEnabled: false });
    stub.pendingSay = cp("g", 0);
    expect(flush(stub)).toBe(false);
    expect(stub.pendingSay).toBeNull();
    expect(stub.liveCheckpointed).toBe(false);
  });

  it("game 列真入档 ⇒ true，置 liveCheckpointed 且历史增长", () => {
    const stub = makeCtx({});
    stub.pendingSay = cp("g", 0);
    expect(flush(stub)).toBe(true);
    expect(stub.pendingSay).toBeNull();
    expect(stub.liveCheckpointed).toBe(true);
    expect(stub.history).toHaveLength(1);
  });

  it("消费即清：再次 flush ⇒ false（不留半提交残留）", () => {
    const stub = makeCtx({});
    stub.pendingSay = cp("g", 0);
    expect(flush(stub)).toBe(true);
    expect(flush(stub)).toBe(false);
  });

  it("丢弃后不污染后续真提交（标记只反映最近一次真入档）", () => {
    const stub = makeCtx({ replayable: false });
    stub.pendingSay = cp("ui", 0);
    flush(stub); // 丢弃，不置位
    expect(stub.liveCheckpointed).toBe(false);
    // 切到 game 列后再补交 ⇒ 真入档才置位
    stub.isCurrentColumnReplayable = () => true;
    stub.pendingSay = cp("g", 0);
    expect(flush(stub)).toBe(true);
    expect(stub.liveCheckpointed).toBe(true);
  });
});
