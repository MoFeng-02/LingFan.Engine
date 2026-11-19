/**
 * 实例族的渲染层差量与落地：完整生命周期（起播/换资源/重播/音量更新/收声/暂停/恢复）。
 *
 * 实例是作者的编排单元，命令面（`audio_play` / `audio_stop` / `audio_volume`）只写状态、
 * 不调端口——把状态落成声音是渲染层的职责，所以起停在这里规划并下发，不存在「两边重复」。
 * 音量按**归属通道**乘玩家偏好（与四通道同口径）。端口实例方法是可选能力：没实现就静默
 * 跳过，否则小程序这类没有实例面的宿主会整段音频停摆。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  AudioPort,
  ResourcePort,
} from "@lingfan-engine/core";
import {
  SYS,
  StoryEngine,
  PlayerPreferences,
  parseStory,
} from "@lingfan-engine/core";
import {
  EMPTY_AUDIO_VIEW,
  createAudioRenderer,
  planAudioActions,
  readAudioView,
  type AudioView,
} from "@lingfan-engine/ui";

/** 实例音量只在 play 态存在（pause/stop 态无 volume）：取用时先收窄 */
function instanceVolume(view: AudioView, id: string): number | undefined {
  const state = view.instances[id];
  return state !== undefined && state.kind === "play"
    ? state.volume
    : undefined;
}

function play(
  resource: string,
  volume = 1,
  extra: {
    seq?: number;
    restart?: boolean;
    loop?: boolean;
    fadeMs?: number;
  } = {},
): AudioChannelState {
  return { kind: "play", resource, volume, loop: true, fadeMs: 0, ...extra };
}

function paused(seq = 1): AudioChannelState {
  return { kind: "pause", seq };
}

function view(partial: Partial<AudioView>): AudioView {
  return { ...EMPTY_AUDIO_VIEW, ...partial };
}

interface InstanceCall {
  kind: "play" | "stop" | "pause" | "resume";
  instanceId: string;
  url?: string;
  volume?: number;
  restart?: boolean;
  fadeMs?: number;
}

/** 只实现承载被测行为的端口面：通道动作照收，实例族可选 */
function makePort(withInstances: boolean): {
  port: AudioPort;
  instanceCalls: InstanceCall[];
} {
  const instanceCalls: InstanceCall[] = [];
  const port: AudioPort = {
    play: () => undefined,
    stop: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    position: () => 0,
    dispose: () => undefined,
  };
  if (withInstances) {
    port.playInstance = (instanceId, url, options) =>
      instanceCalls.push({
        kind: "play",
        instanceId,
        url,
        volume: options.volume,
        restart: options.restart,
      });
    port.stopInstance = (instanceId, fadeMs) =>
      instanceCalls.push({ kind: "stop", instanceId, fadeMs });
    port.pauseInstance = (instanceId) =>
      instanceCalls.push({ kind: "pause", instanceId });
    port.resumeInstance = (instanceId) =>
      instanceCalls.push({ kind: "resume", instanceId });
  }
  return { port, instanceCalls };
}

const resources: ResourcePort = {
  resolve: (id) => Promise.resolve(`/${id}`),
  release: () => undefined,
};

/** 异步解析落地需要 flush 微任务（playInstance 经 resolveUrl 异步到端口） */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeStoryEngine(commands: object[]): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "audio-instance-ui",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 3 },
  );
}

describe("实例差量 → 端口动作（完整生命周期）", () => {
  it("play 变 pause → pauseInstance（实例保留播放器与位置）", () => {
    const before = view({ instances: { rain: play("rain.mp3", 0.3) } });
    const after = view({ instances: { rain: paused() } });
    expect(planAudioActions(before, after)).toEqual([
      { type: "pauseInstance", instanceId: "rain" },
    ]);
  });

  it("pause 变 play → resumeInstance，不是 play（重播会从头开始）", () => {
    const before = view({ instances: { rain: paused() } });
    const after = view({ instances: { rain: play("rain.mp3", 0.3) } });
    expect(planAudioActions(before, after)).toEqual([
      { type: "resumeInstance", instanceId: "rain" },
    ]);
  });

  it("新增实例 → playInstance 从头起播", () => {
    const before = view({ instances: {} });
    const after = view({ instances: { rain: play("rain.mp3", 0.3) } });
    expect(planAudioActions(before, after)).toEqual([
      {
        type: "playInstance",
        instanceId: "rain",
        resource: "rain.mp3",
        volume: 0.3,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("换资源 → playInstance 重播", () => {
    const before = view({ instances: { rain: play("rain.mp3") } });
    const after = view({ instances: { rain: play("storm.mp3") } });
    expect(planAudioActions(before, after)).toEqual([
      {
        type: "playInstance",
        instanceId: "rain",
        resource: "storm.mp3",
        volume: 1,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("同资源显式重播（restart + seq 变化）→ playInstance 回到起点", () => {
    const before = view({
      instances: { rain: play("rain.mp3", 1, { seq: 1 }) },
    });
    const after = view({
      instances: { rain: play("rain.mp3", 1, { seq: 2, restart: true }) },
    });
    expect(planAudioActions(before, after)).toEqual([
      {
        type: "playInstance",
        instanceId: "rain",
        resource: "rain.mp3",
        volume: 1,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("同资源仅音量变化 → playInstance 更新不重播（audio_volume 口径）", () => {
    const before = view({
      instances: { rain: play("rain.mp3", 0.5, { seq: 1 }) },
    });
    const after = view({
      instances: { rain: play("rain.mp3", 0.8, { seq: 1 }) },
    });
    expect(planAudioActions(before, after)).toEqual([
      {
        type: "playInstance",
        instanceId: "rain",
        resource: "rain.mp3",
        volume: 0.8,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: false,
      },
    ]);
  });

  it("转 stop 态 → stopInstance（带淡出）", () => {
    const before = view({ instances: { rain: play("rain.mp3") } });
    const after = view({ instances: { rain: { kind: "stop", fadeMs: 200 } } });
    expect(planAudioActions(before, after)).toEqual([
      { type: "stopInstance", instanceId: "rain", fadeMs: 200 },
    ]);
  });

  it("实例整体消失（表被清空）→ stopInstance 收声", () => {
    const before = view({ instances: { rain: play("rain.mp3") } });
    expect(planAudioActions(before, view({ instances: {} }))).toEqual([
      { type: "stopInstance", instanceId: "rain", fadeMs: 0 },
    ]);
  });

  it("多实例按 id 排序下发，动作序列确定", () => {
    const before = view({
      instances: {
        wind: play("wind.mp3"),
        rain: play("rain.mp3"),
        fire: play("fire.mp3"),
      },
    });
    const after = view({
      instances: { wind: paused(), rain: paused(), fire: paused() },
    });
    expect(planAudioActions(before, after)).toEqual([
      { type: "pauseInstance", instanceId: "fire" },
      { type: "pauseInstance", instanceId: "rain" },
      { type: "pauseInstance", instanceId: "wind" },
    ]);
  });

  it("幂等：同一份实例状态重放（读档后 sync）不再出动作", () => {
    const state = view({ instances: { rain: paused(), wind: play("w.mp3") } });
    expect(planAudioActions(state, state)).toEqual([]);
  });

  it("通道与实例互不代偿：通道 play→pause 时实例该 resume 仍照常出", () => {
    const before = view({
      bgm: play("bgm.mp3"),
      instances: { rain: paused() },
    });
    const after = view({
      bgm: paused(),
      instances: { rain: play("rain.mp3") },
    });
    expect(planAudioActions(before, after)).toEqual([
      { type: "pause", channel: "bgm" },
      { type: "resumeInstance", instanceId: "rain" },
    ]);
  });
});

describe("实例音量按归属通道乘玩家偏好", () => {
  function engineWithInstance(channel: string, volume: number): StoryEngine {
    const engine = makeStoryEngine([
      { op: "audio_play", inst: "rain", channel, resource: "rain.mp3", volume },
    ]);
    engine.start();
    return engine;
  }

  it("op 音量 × 归属通道偏好（与四通道同口径）", () => {
    const engine = engineWithInstance("ambient", 0.5);
    const prefs = new PlayerPreferences();
    prefs.setVolume("ambient", 0.5);
    try {
      const v = readAudioView(engine, prefs);
      expect(instanceVolume(v, "rain")).toBeCloseTo(0.25, 5);
    } finally {
      engine.dispose();
      prefs.dispose();
    }
  });

  it("静音把实例音量归零", () => {
    const engine = engineWithInstance("ambient", 0.5);
    const prefs = new PlayerPreferences();
    prefs.setMuted(true);
    try {
      const v = readAudioView(engine, prefs);
      expect(instanceVolume(v, "rain")).toBe(0);
    } finally {
      engine.dispose();
      prefs.dispose();
    }
  });

  it("不同归属通道各乘各档偏好", () => {
    const engine = makeStoryEngine([
      {
        op: "audio_play",
        inst: "a",
        channel: "bgm",
        resource: "a.mp3",
        volume: 1,
      },
      {
        op: "audio_play",
        inst: "b",
        channel: "voice",
        resource: "b.mp3",
        volume: 1,
      },
    ]);
    engine.start();
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 0.5);
    prefs.setVolume("voice", 0.2);
    try {
      const v = readAudioView(engine, prefs);
      expect(instanceVolume(v, "a")).toBeCloseTo(0.5, 5);
      expect(instanceVolume(v, "b")).toBeCloseTo(0.2, 5);
    } finally {
      engine.dispose();
      prefs.dispose();
    }
  });
});

describe("渲染器 · 实例起停与暂停", () => {
  it("起播/暂停/恢复/收声全链落到端口", async () => {
    const engine = makeStoryEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "rain.mp3",
        volume: 0.3,
      },
      { op: "say", text: "停" },
    ]);
    const { port, instanceCalls } = makePort(true);
    const renderer = createAudioRenderer(engine, port, resources);
    try {
      engine.start();
      await flush();
      expect(instanceCalls).toEqual([
        {
          kind: "play",
          instanceId: "rain",
          url: "/rain.mp3",
          volume: 0.3,
          restart: true,
        },
      ]);

      instanceCalls.length = 0;
      engine.pause();
      expect(instanceCalls).toEqual([{ kind: "pause", instanceId: "rain" }]);

      instanceCalls.length = 0;
      engine.resume();
      expect(instanceCalls).toEqual([{ kind: "resume", instanceId: "rain" }]);

      instanceCalls.length = 0;
      engine.submitSceneOps([{ op: "audio_stop", inst: "rain" }]);
      await flush();
      expect(
        instanceCalls.some((c) => c.kind === "stop" && c.instanceId === "rain"),
      ).toBe(true);
    } finally {
      renderer.dispose();
      engine.dispose();
    }
  });

  it("端口没有实例能力：静默跳过，不抛错、不挡住通道动作", () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "bgm.mp3", volume: 0.5 },
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "rain.mp3",
      },
    ]);
    const { port } = makePort(false);
    const renderer = createAudioRenderer(engine, port, resources);
    try {
      engine.start();
      expect(() => engine.pause()).not.toThrow();
      expect(engine.get(SYS.audioBgm)).toMatchObject({ kind: "pause" });
      expect(() => engine.resume()).not.toThrow();
      expect(engine.get(SYS.audioBgm)).toMatchObject({ kind: "play" });
    } finally {
      renderer.dispose();
      engine.dispose();
    }
  });
});
