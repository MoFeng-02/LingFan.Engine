/**
 * 小程序视频端口测试：假呈现面替身（记账 show/hide/pause/resume/seek）。
 * 小程序的 `video` 是声明式组件，本包只推状态；要锁住的语义是层 z 随 `show` 下发、
 * 未播放时不打扰呈现面、自然结束只通知当前那次 `play` 的回调。
 */
import { describe, expect, it } from "vitest";
import type { MiniprogramVideoSurfaceLike } from "@lingfan-engine/adapters";
import { createMiniprogramVideoPort } from "@lingfan-engine/adapters";

/** 呈现面替身：记下每次下发的状态，并允许测试触发 `bindended` */
class FakeVideoSurface implements MiniprogramVideoSurfaceLike {
  readonly shows: Array<{
    url: string;
    volume: number;
    loop: boolean;
    zIndex?: number;
  }> = [];
  hideCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  readonly seeks: number[] = [];
  #ended: (() => void) | null = null;

  show(request: {
    url: string;
    volume: number;
    loop: boolean;
    zIndex?: number;
  }): void {
    this.shows.push(request);
  }

  hide(): void {
    this.hideCount += 1;
  }

  pause(): void {
    this.pauseCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }

  seek(seconds: number): void {
    this.seeks.push(seconds);
  }

  onEnded(callback: () => void): void {
    this.#ended = callback;
  }

  /** 测试钩子：模拟组件播完 */
  fireEnded(): void {
    this.#ended?.();
  }
}

describe("createMiniprogramVideoPort（推状态给呈现面）", () => {
  it("play：把 url / 夹过的音量 / 循环 / 层 z 一并下发", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    port.play("usr/op.mp4", { volume: 3, loop: true });
    expect(surface.shows).toEqual([
      { url: "usr/op.mp4", volume: 1, loop: true, zIndex: 5 },
    ]);
  });

  it("构造期层 z 覆盖：随每次 show 下发", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface, { zIndex: 7 });
    port.play("usr/op.mp4", { volume: 0.4, loop: false });
    expect(surface.shows[0]).toEqual({
      url: "usr/op.mp4",
      volume: 0.4,
      loop: false,
      zIndex: 7,
    });
  });

  it("没播过时 pause / resume / seek 不打扰呈现面", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    port.pause();
    port.resume();
    port.seek(5);
    expect(surface.pauseCount).toBe(0);
    expect(surface.resumeCount).toBe(0);
    expect(surface.seeks).toEqual([]);
  });

  it("播放后转发 pause / resume / seek，负位置钳到 0", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    port.play("usr/op.mp4", { volume: 0.4, loop: false });
    port.pause();
    port.resume();
    port.seek(-3);
    port.seek(12.5);
    expect(surface.pauseCount).toBe(1);
    expect(surface.resumeCount).toBe(1);
    expect(surface.seeks).toEqual([0, 12.5]);
  });

  it("自然结束：通知当前这次 play 的回调", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    let ended = 0;
    port.play("usr/op.mp4", { volume: 1, loop: false }, () => {
      ended += 1;
    });
    surface.fireEnded();
    expect(ended).toBe(1);
  });

  it("stop 后组件再报结束不再回调（过场等待不会二次解除）", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    let ended = 0;
    port.play("usr/op.mp4", { volume: 1, loop: false }, () => {
      ended += 1;
    });
    port.stop();
    surface.fireEnded();
    expect(ended).toBe(0);
    expect(surface.hideCount).toBe(1);
  });

  it("新 play 替换：只有最新一次的回调被通知", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    const calls: string[] = [];
    port.play("usr/a.mp4", { volume: 1, loop: false }, () => {
      calls.push("a");
    });
    port.play("usr/b.mp4", { volume: 1, loop: false }, () => {
      calls.push("b");
    });
    surface.fireEnded();
    expect(calls).toEqual(["b"]);
  });

  it("dispose：收掉呈现面（不留着占屏）", () => {
    const surface = new FakeVideoSurface();
    const port = createMiniprogramVideoPort(surface);
    port.play("usr/op.mp4", { volume: 1, loop: false });
    port.dispose();
    expect(surface.hideCount).toBe(1);
  });
});
