/**
 * 08 §六.5 视频渲染测试：命令流 → 端口执行（seq 去重 / 代际取消 / fail-closed / ended 上报）。
 * 按契约 Mock：VideoPort 与 ResourcePort 为契约的可行实现（node 环境无解码器）。
 */
import { describe, expect, it } from "vitest";
import type { ResourcePort, VideoPort } from "@lingfan/engine";
import { SYS, StoryEngine } from "@lingfan/engine";
import { parseStory } from "@lingfan/engine";
import { createVideoRenderer } from "./videoView";

function makeStoryEngine(commands: object[]): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "video-ui",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 3 },
  );
}

interface Call {
  kind: "play" | "pause" | "resume" | "seek" | "stop";
  url?: string;
  volume?: number;
  loop?: boolean;
  onEnded?: () => void;
  seconds?: number;
}

function makePort(): { port: VideoPort; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    port: {
      play: (url, options, onEnded) =>
        calls.push({
          kind: "play",
          url,
          volume: options.volume,
          loop: options.loop,
          onEnded,
        }),
      pause: () => calls.push({ kind: "pause" }),
      resume: () => calls.push({ kind: "resume" }),
      seek: (seconds) => calls.push({ kind: "seek", seconds }),
      stop: () => calls.push({ kind: "stop" }),
      dispose: () => undefined,
    },
  };
}

function makeResources(): {
  port: ResourcePort;
  released: string[];
  fail: (id: string) => void;
} {
  const released: string[] = [];
  const resolveCalls: string[] = [];
  const failures = new Set<string>();
  return {
    released,
    fail: (id) => failures.add(id),
    port: {
      resolve(id) {
        resolveCalls.push(id);
        if (failures.has(id)) return Promise.reject(new Error(`缺失：${id}`));
        return Promise.resolve(`/${id}`);
      },
      release(url) {
        released.push(url);
      },
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("08 §六.5 视频渲染（命令流 → 端口执行）", () => {
  it("video 发 play（解析 URL + 音量/循环）；stop 在其后执行", async () => {
    const engine = makeStoryEngine([
      { op: "video", resource: "Video/m1.mp4", volume: 0.6, loop: true },
      { op: "say", text: "一" },
      { op: "stop_video" },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createVideoRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    engine.advance(); // 越过 say → stop_video 执行
    await flush();
    expect(calls).toEqual([
      {
        kind: "play",
        url: "/Video/m1.mp4",
        volume: 0.6,
        loop: true,
        onEnded: undefined, // 非阻塞 video 无 ended 语义
      },
      { kind: "stop" },
    ]);
    renderer.dispose();
    engine.dispose();
  });

  it("cutscene：ended 上报 → 组合根回调 engine.videoFinished 解除等待", async () => {
    const engine = makeStoryEngine([
      { op: "cutscene", resource: "Video/m1.mp4", volume: 0.8 },
      { op: "say", text: "过场后" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    let finished = 0;
    const renderer = createVideoRenderer(engine, port, resources.port, {
      onVideoFinished: () => {
        finished += 1;
        engine.videoFinished(); // 组合根职责：把「播完」翻译成引擎命令
      },
    });
    engine.start();
    await flush();
    expect(engine.get(SYS.waiting)).toBe("video");
    // 模拟播放器自然结束：调用 play 时登记的 onEnded
    calls[0]?.onEnded?.();
    expect(finished).toBe(1);
    expect(engine.get(SYS.waiting)).toBe("dialog"); // 引擎已解除等待
    renderer.dispose();
    engine.dispose();
  });

  it("seq 去重：同命令（重放/读档恢复）不重复执行", async () => {
    const engine = makeStoryEngine([
      { op: "video", resource: "Video/a.mp4" },
      { op: "say", text: "一" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createVideoRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    calls.length = 0;
    renderer.sync(); // 同 seq：不重复执行
    await flush();
    expect(calls).toEqual([]);
    renderer.dispose();
    engine.dispose();
  });

  it("回溯对齐：命令流回退（seq 变小）→ 重执行恢复态命令（03 §一.2：媒体回滚 seek 或重播）", async () => {
    const engine = makeStoryEngine([
      { op: "video", resource: "Video/a.mp4" },
      { op: "say", text: "一" },
      { op: "stop_video" },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createVideoRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    engine.advance(); // stop_video 已执行
    await flush();
    calls.length = 0;
    engine.rollbackTo(0); // 回到视频段内：恢复态里视频「正在播放」
    renderer.sync();
    await flush();
    expect(calls.at(-1)?.kind).toBe("play"); // 重执行恢复态命令（重播）
    renderer.dispose();
    engine.dispose();
  });

  it("解析失败 fail-closed：不播放且诊断上报", async () => {
    const engine = makeStoryEngine([
      { op: "video", resource: "Video/missing.mp4" },
      { op: "say", text: "一" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    resources.fail("Video/missing.mp4");
    const messages: string[] = [];
    const renderer = createVideoRenderer(engine, port, resources.port, {
      onError: (m) => messages.push(m),
    });
    engine.start();
    await flush();
    expect(calls).toEqual([]);
    expect(messages[0]).toContain("资源解析失败");
    renderer.dispose();
    engine.dispose();
  });

  it("dispose 释放已解析资源", async () => {
    const engine = makeStoryEngine([
      { op: "video", resource: "Video/a.mp4" },
      { op: "say", text: "一" },
    ]);
    const { port } = makePort();
    const resources = makeResources();
    const renderer = createVideoRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    renderer.dispose();
    expect(resources.released).toEqual(["/Video/a.mp4"]);
    engine.dispose();
  });
});
