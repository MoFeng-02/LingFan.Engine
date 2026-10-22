/**
 * 小程序帧源测试：假帧面替身 + 与 `@lingfan-engine/ui` 的 `FrameSource` 结构互锁。
 * 本包不依赖界面层（依赖方向不能倒置），两者的一致性靠这里的类型标注来锁：
 * 一旦任一侧改了方法名或签名，这里的赋值会先编译失败。
 */
import { describe, expect, it } from "vitest";
import type { FrameSource } from "@lingfan-engine/ui";
import type { MiniprogramCanvasFrameLike } from "@lingfan-engine/adapters";
import { createMiniprogramFrameSource } from "@lingfan-engine/adapters";

/** 帧面替身：登记回调，句柄自增（从 1 起，0 留给「无句柄」） */
class FakeCanvasFrame implements MiniprogramCanvasFrameLike {
  #next = 1;
  readonly requested = new Map<number, (now: number) => void>();
  readonly cancelled: number[] = [];

  requestAnimationFrame(callback: (now: number) => void): number {
    const handle = this.#next;
    this.#next += 1;
    this.requested.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle: number): void {
    this.cancelled.push(handle);
    this.requested.delete(handle);
  }

  /** 测试钩子：推进一帧 */
  tick(now: number): void {
    for (const callback of [...this.requested.values()]) callback(now);
  }
}

describe("createMiniprogramFrameSource（帧面转发）", () => {
  it("request 返回平台句柄，回调收到平台时间原点", () => {
    const canvas = new FakeCanvasFrame();
    const source = createMiniprogramFrameSource(canvas);
    const stamps: number[] = [];
    const handle = source.request((now) => {
      stamps.push(now);
    });
    expect(handle).toBe(1);
    canvas.tick(1234);
    expect(stamps).toEqual([1234]);
  });

  it("cancel 转发给帧面", () => {
    const canvas = new FakeCanvasFrame();
    const source = createMiniprogramFrameSource(canvas);
    const handle = source.request(() => undefined);
    source.cancel(handle);
    expect(canvas.cancelled).toEqual([handle]);
  });

  it("与界面层的 FrameSource 结构一致（改签名会在此处编译失败）", () => {
    const canvas = new FakeCanvasFrame();
    const source: FrameSource = createMiniprogramFrameSource(canvas);
    const handle = source.request(() => undefined);
    source.cancel(handle);
    expect(canvas.cancelled).toEqual([handle]);
  });
});
