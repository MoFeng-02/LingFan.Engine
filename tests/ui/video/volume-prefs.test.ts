/**
 * 视频音量乘偏好：视频音轨按 `bgm` 通道的玩家偏好衰减。
 *
 * 三件事分三层断言：
 * - **下发值**：`play` 时端口收到的音量 = op 音量 × 偏好（静音归零）；
 * - **不重播**：偏好变化只改音量，不产生新的 `play`（过场正在放，重播会打断画面）；
 * - **零影响**：未注入偏好时行为与改造前逐字节一致。
 *
 * 视频没有独立音频通道，故借 `bgm`；这是当前口径，不是终态。
 */
import { describe, expect, it } from "vitest";
import type { ResourcePort, VideoPort } from "@lingfan-engine/core";
import {
  PlayerPreferences,
  SYS,
  StoryEngine,
  parseStory,
} from "@lingfan-engine/core";
import { createVideoRenderer } from "@lingfan-engine/ui";

function makeEngine(commands: object[]): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "video-prefs",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 7 },
  );
}

interface Call {
  kind: "play" | "pause" | "resume" | "seek" | "stop" | "setVolume";
  url?: string;
  volume?: number;
  loop?: boolean;
}

function makePort(): { port: VideoPort; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    port: {
      play: (url, options) =>
        calls.push({
          kind: "play",
          url,
          volume: options.volume,
          loop: options.loop,
        }),
      pause: () => calls.push({ kind: "pause" }),
      resume: () => calls.push({ kind: "resume" }),
      seek: () => calls.push({ kind: "seek" }),
      stop: () => calls.push({ kind: "stop" }),
      setVolume: (volume) => calls.push({ kind: "setVolume", volume }),
      dispose: () => undefined,
    },
  };
}

function makeResources(): ResourcePort {
  return {
    resolve: (id) => Promise.resolve(`/${id}`),
    release: () => undefined,
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("视频音量乘偏好（bgm 通道）", () => {
  it("下发音量 = op 音量 × bgm 偏好", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 0.8, loop: false },
    ]);
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 0.5);
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources(), { preferences: prefs });

    engine.start();
    await flush();
    expect(calls).toEqual([
      { kind: "play", url: "/Video/a.mp4", volume: 0.4, loop: false },
    ]);
  });

  it("静音时下发 0，但不产生 stop（停播是另一件事）", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 0.8, loop: false },
    ]);
    const prefs = new PlayerPreferences();
    prefs.setMuted(true);
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources(), { preferences: prefs });

    engine.start();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "play", volume: 0 });
    expect(calls.some((call) => call.kind === "stop")).toBe(false);
  });

  it("偏好变化只改音量，不重播（play 仍只有一次）", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 1, loop: true },
    ]);
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 1);
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources(), { preferences: prefs });

    engine.start();
    await flush();
    expect(calls).toHaveLength(1);

    prefs.setVolume("bgm", 0.25);
    const plays = calls.filter((call) => call.kind === "play");
    expect(plays).toHaveLength(1); // 没有第二次 play
    expect(calls.at(-1)).toEqual({ kind: "setVolume", volume: 0.25 });
  });

  it("未注入偏好：下发值等于 op 音量（与改造前一致）", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 0.6, loop: false },
    ]);
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources());

    engine.start();
    await flush();
    expect(calls).toEqual([
      { kind: "play", url: "/Video/a.mp4", volume: 0.6, loop: false },
    ]);
  });

  it("偏好为 1 时不复制音量对象语义：下发值仍是 op 音量本身", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 0.33, loop: false },
    ]);
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 1);
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources(), { preferences: prefs });

    engine.start();
    await flush();
    expect(calls[0]).toMatchObject({ kind: "play", volume: 0.33 });
  });

  it("偏好变化时若当前无播放命令：不发 setVolume（不凭空造动作）", async () => {
    const engine = makeEngine([{ op: "say", text: "无视频" }]);
    const prefs = new PlayerPreferences();
    const { port, calls } = makePort();
    createVideoRenderer(engine, port, makeResources(), { preferences: prefs });

    engine.start();
    await flush();
    prefs.setVolume("bgm", 0.2);
    expect(calls).toEqual([]);
  });

  it("dispose 退订偏好：之后再改音量不再触达端口", async () => {
    const engine = makeEngine([
      { op: "video", resource: "Video/a.mp4", volume: 1, loop: true },
    ]);
    const prefs = new PlayerPreferences();
    const { port, calls } = makePort();
    const renderer = createVideoRenderer(engine, port, makeResources(), {
      preferences: prefs,
    });

    engine.start();
    await flush();
    const before = calls.length;
    renderer.dispose();
    prefs.setVolume("bgm", 0.1);
    expect(calls).toHaveLength(before);
    expect(engine.get(SYS.video)).not.toBeUndefined();
  });
});
