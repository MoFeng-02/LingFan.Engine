/**
 * 宿主帧循环装配：帧源由宿主注入，每帧顺序与收尾语义在这里钉住。
 *
 * 帧源写死成浏览器 rAF 时，没有同一套帧 API 的宿主（小程序画布）只能另抄一份循环，
 * 于是打字机推进与媒体回写会各自演化。故用假帧源驱动，断言排帧与取消只经注入面，
 * 并用源级断言锁住「本模块不认任何平台帧 API」。
 */
import type { FrameSource } from "@lingfan-engine/ui";
import { describe, expect, it } from "vitest";
import {
  startHostFrameLoop,
  type HostFrameLoopOptions,
} from "../../../packages/shell/src/frame";

/** 本模块源码（源级断言用）：只该经注入面排帧 */
const SOURCE = import.meta.glob(
  "../../../packages/shell/src/frame/appFrameLoop.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 假帧源：手动推进帧，记账已排定与已取消的句柄 */
function fakeFrameSource(): {
  source: FrameSource;
  pending(): number[];
  cancelled(): number[];
  tick(now: number): void;
} {
  const waiting = new Map<number, (now: number) => void>();
  const cancelledHandles: number[] = [];
  let last = 0;
  const source: FrameSource = {
    request(callback: (now: number) => void): number {
      last += 1;
      waiting.set(last, callback);
      return last;
    },
    cancel(handle: number): void {
      cancelledHandles.push(handle);
      waiting.delete(handle);
    },
  };
  return {
    source,
    pending: () => [...waiting.keys()],
    cancelled: () => cancelledHandles,
    tick(now: number): void {
      const entry = [...waiting.entries()].pop();
      if (entry === undefined) throw new Error("没有已排定的帧可推进");
      waiting.delete(entry[0]);
      entry[1](now);
    },
  };
}

/** 记录调用顺序的帧回调；打字机可选（null = 本帧没有打字机） */
function recordingOptions(
  order: string[],
  typewriter: { visible: string } | null = { visible: "可见" },
): HostFrameLoopOptions {
  return {
    frame: fakeFrameSource().source,
    readTypewriter: () =>
      typewriter === null
        ? null
        : {
            tick: (dtSeconds: number) => order.push(`tick:${dtSeconds}`),
            visible: typewriter.visible,
          },
    onText: (visible: string) => order.push(`text:${visible}`),
    onMediaTick: () => order.push("media"),
    onFrame: (dt: number) => order.push(`frame:${dt}`),
  };
}

describe("宿主帧循环装配", () => {
  it("启动即排帧，停止把取消作用在已排定的句柄上", () => {
    const frames = fakeFrameSource();
    const loop = startHostFrameLoop({
      ...recordingOptions([]),
      frame: frames.source,
    });
    expect(frames.pending()).toHaveLength(1);
    const handle = frames.pending()[0];
    loop.stop();
    expect(frames.cancelled()).toEqual([handle]);
    expect(frames.pending()).toEqual([]);
  });

  it("每帧顺序固定：打字机推进 → 上交可见文本 → 媒体回写 → 帧驱动表现", () => {
    const frames = fakeFrameSource();
    const order: string[] = [];
    startHostFrameLoop({ ...recordingOptions(order), frame: frames.source });
    // 首帧没有上一帧可比，dt 记 0：否则开场会凭空多推进一段时间
    frames.tick(500);
    expect(order).toEqual(["tick:0", "text:可见", "media", "frame:0"]);
    order.length = 0;
    frames.tick(1500);
    expect(order).toEqual(["tick:1", "text:可见", "media", "frame:1"]);
  });

  it("没有打字机时上交空串（由调用方决定怎么用正文兜底）", () => {
    const frames = fakeFrameSource();
    const order: string[] = [];
    startHostFrameLoop({
      ...recordingOptions(order, null),
      frame: frames.source,
    });
    frames.tick(1000);
    expect(order).toEqual(["text:", "media", "frame:0"]);
  });

  it("已在运行时再启不叠帧（续帧只由帧内那一处排定）", () => {
    const frames = fakeFrameSource();
    const loop = startHostFrameLoop(recordingOptions([]));
    expect(frames.pending()).toHaveLength(0);
    const withFrames = startHostFrameLoop({
      ...recordingOptions([]),
      frame: frames.source,
    });
    expect(frames.pending()).toHaveLength(1);
    withFrames.start();
    expect(frames.pending()).toHaveLength(1);
    loop.stop();
    withFrames.stop();
  });

  it("源级：本模块不认平台帧 API，排帧与取消只经注入的帧源", () => {
    const source = Object.values(SOURCE)[0] ?? "";
    expect(source).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/);
    expect(source).not.toMatch(/\bdocument\b|\bwindow\b/);
    expect(source).toMatch(/frame:\s*options\.frame/);
  });
});
