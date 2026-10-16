/**
 * 小程序音频端口测试：假 `InnerAudioContext` 替身（记账 src 赋值次数、play/stop/seek/destroy）。
 * 要锁住的语义：同源不重设 `src`（避免重复解码）、`restart` 才回到起点、一次性通道允许叠放并靠
 * `onEnded` 回收、音量斜坡用定时器推进、`position` 读平台只读位置。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WechatAudioContextLike } from "@lingfan/adapters";
import { createWechatAudioPort } from "@lingfan/adapters";

/** 单个音频实例替身：`src` 用访问器记账，其余动作只累计调用 */
class FakeAudioContext implements WechatAudioContextLike {
  #src = "";
  volume = 1;
  loop = false;
  currentTime = 0;
  playCount = 0;
  stopCount = 0;
  destroyCount = 0;
  /** 记下每次 `src` 赋值（同源续播不该产生新的一次） */
  readonly srcWrites: string[] = [];
  readonly seeks: number[] = [];
  #ended: (() => void) | null = null;

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    this.srcWrites.push(value);
  }

  play(): void {
    this.playCount += 1;
  }

  stop(): void {
    this.stopCount += 1;
  }

  seek(position: number): void {
    this.seeks.push(position);
  }

  destroy(): void {
    this.destroyCount += 1;
  }

  onEnded(callback: () => void): void {
    this.#ended = callback;
  }

  /** 测试钩子：模拟自然播完 */
  fireEnded(): void {
    this.#ended?.();
  }
}

/** 造端口并保留所有被创建实例的清单（宿主注入的工厂在真实环境是 `wx.createInnerAudioContext`） */
function setup(): {
  port: ReturnType<typeof createWechatAudioPort>;
  created: FakeAudioContext[];
} {
  const created: FakeAudioContext[] = [];
  const port = createWechatAudioPort(() => {
    const context = new FakeAudioContext();
    created.push(context);
    return context;
  });
  return { port, created };
}

/** 常用播放入参：只写本用例关心的字段 */
const OPTS = {
  volume: 1,
  loop: false,
  position: 0,
  fadeMs: 0,
  restart: false,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWechatAudioPort（常驻通道）", () => {
  it("起播：写入 src / 音量 / 循环并调用 play", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/bgm.mp3", {
      ...OPTS,
      volume: 0.5,
      loop: true,
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.srcWrites).toEqual(["/Audio/bgm.mp3"]);
    expect(created[0]?.volume).toBe(0.5);
    expect(created[0]?.loop).toBe(true);
    expect(created[0]?.playCount).toBe(1);
  });

  it("同源续播：不重设 src、不再调 play，只更新音量与循环", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/bgm.mp3", OPTS);
    port.play("bgm", "/Audio/bgm.mp3", { ...OPTS, volume: 0.8, loop: true });
    expect(created).toHaveLength(1);
    expect(created[0]?.srcWrites).toEqual(["/Audio/bgm.mp3"]);
    expect(created[0]?.playCount).toBe(1);
    expect(created[0]?.volume).toBe(0.8);
    expect(created[0]?.loop).toBe(true);
  });

  it("restart=true 同源：重设 src 并重新起播", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/bgm.mp3", OPTS);
    port.play("bgm", "/Audio/bgm.mp3", { ...OPTS, restart: true });
    expect(created[0]?.srcWrites).toHaveLength(2);
    expect(created[0]?.playCount).toBe(2);
    expect(created[0]?.stopCount).toBe(1);
  });

  it("换源：重设 src（同时清掉上一次）", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", OPTS);
    port.play("bgm", "/Audio/b.mp3", OPTS);
    expect(created).toHaveLength(1);
    expect(created[0]?.srcWrites).toEqual(["/Audio/a.mp3", "/Audio/b.mp3"]);
  });

  it("音量越界按边界处理，而不是整段静音", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 2 });
    expect(created[0]?.volume).toBe(1);
    port.play("bgm", "/Audio/b.mp3", { ...OPTS, volume: -1 });
    expect(created[0]?.volume).toBe(0);
  });

  it("起始位置：大于 0 才 seek（0 不打扰平台）", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, position: 12.5 });
    expect(created[0]?.seeks).toEqual([12.5]);
    port.play("bgm", "/Audio/b.mp3", { ...OPTS, position: 0 });
    expect(created[0]?.seeks).toEqual([12.5]);
  });

  it("同源续播时位置偏差大于容差才 seek（避免每帧抖动）", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", OPTS);
    const context = created[0];
    if (context === undefined) throw new Error("应已创建实例");
    context.currentTime = 10;
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, position: 10.1 });
    expect(context.seeks).toEqual([]);
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, position: 30 });
    expect(context.seeks).toEqual([30]);
  });

  it("position 读平台只读位置；未播放的通道返回 0", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", OPTS);
    const context = created[0];
    if (context === undefined) throw new Error("应已创建实例");
    context.currentTime = 7.25;
    expect(port.position("bgm")).toBe(7.25);
    expect(port.position("voice")).toBe(0);
  });
});

describe("createWechatAudioPort（一次性 se 通道）", () => {
  it("每次都是新实例（允许叠放），播完只回收自己", () => {
    const { port, created } = setup();
    port.play("se", "/Audio/hit.mp3", OPTS);
    port.play("se", "/Audio/hit.mp3", OPTS);
    expect(created).toHaveLength(2);
    created[0]?.fireEnded();
    expect(created[0]?.destroyCount).toBe(1);
    expect(created[1]?.destroyCount).toBe(0);
  });

  it("stop('se') 不动一次性实例（与 Web 实现同口径：一次性播完自净）", () => {
    const { port, created } = setup();
    port.play("se", "/Audio/hit.mp3", OPTS);
    port.stop("se");
    expect(created[0]?.destroyCount).toBe(0);
    expect(created[0]?.stopCount).toBe(0);
  });

  it("dispose 连叠放的实例一起销毁", () => {
    const { port, created } = setup();
    port.play("se", "/Audio/a.mp3", OPTS);
    port.play("se", "/Audio/b.mp3", OPTS);
    port.dispose();
    expect(created.map((context) => context.destroyCount)).toEqual([1, 1]);
  });
});

describe("createWechatAudioPort（音量斜坡）", () => {
  it("淡入：从 0 爬到目标音量", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 0.8, fadeMs: 120 });
    expect(created[0]?.volume).toBe(0);
    vi.advanceTimersByTime(200);
    expect(created[0]?.volume).toBeCloseTo(0.8, 5);
  });

  it("淡出：音量归零后停播并复位音量（下次淡入以满音量为基准）", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 0.6 });
    port.stop("bgm", 100);
    vi.advanceTimersByTime(200);
    expect(created[0]?.stopCount).toBe(1);
    expect(created[0]?.volume).toBe(1);
  });

  it("淡出中途重新起播：旧斜坡被取消，音量跟着新目标走", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 0.5 });
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 1, fadeMs: 100 });
    vi.advanceTimersByTime(50);
    port.stop("bgm", 200);
    vi.advanceTimersByTime(400);
    expect(created[0]?.stopCount).toBe(1);
    expect(created[0]?.volume).toBe(1);
  });

  it("淡入中 dispose：定时器不再推进（不再触碰已销毁实例）", () => {
    const { port, created } = setup();
    port.play("bgm", "/Audio/a.mp3", { ...OPTS, volume: 0.9, fadeMs: 200 });
    vi.advanceTimersByTime(32);
    port.dispose();
    const touched = created[0]?.volume;
    vi.advanceTimersByTime(400);
    expect(created[0]?.volume).toBe(touched);
  });
});
