/**
 * 实例族的渲染层差量：`play ↔ pause` 翻成 `pauseInstance?` / `resumeInstance?`。
 *
 * 只翻这一对——实例的起播与收声属于实例命令面（`audio_play` / `audio_stop`），
 * 渲染层再发一遍就是重复下发。端口方法是可选能力：没实现就静默跳过，
 * 否则小程序这类没有 pause 面的宿主会整段音频停摆。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  AudioPort,
  ResourcePort,
} from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";
import {
  EMPTY_AUDIO_VIEW,
  createAudioRenderer,
  planAudioActions,
  type AudioView,
} from "@lingfan-engine/ui";

function play(resource: string, volume = 1): AudioChannelState {
  return { kind: "play", resource, volume, loop: true, fadeMs: 0 };
}

function paused(seq = 1): AudioChannelState {
  return { kind: "pause", seq };
}

function view(partial: Partial<AudioView>): AudioView {
  return { ...EMPTY_AUDIO_VIEW, ...partial };
}

interface InstanceCall {
  kind: "pause" | "resume";
  instanceId: string;
}

/** 只实现承载被测行为的端口面：通道动作照收，实例暂停可选 */
function makePort(withInstancePause: boolean): {
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
  if (withInstancePause) {
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

const TWO_INSTANCES = [
  {
    op: "audio_play",
    inst: "rain",
    channel: "ambient",
    resource: "rain.mp3",
    volume: 0.3,
  },
  { op: "audio_play", inst: "wind", channel: "se", resource: "wind.mp3" },
  { op: "say", text: "停" },
];

describe("实例差量 → 端口动作", () => {
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

  it("停止与新建不在这里下发：stop 态、新增实例都零动作", () => {
    // 起播归 audio_play、收声归 audio_stop；渲染层重复下发会叠出第二个播放器
    const before = view({ instances: { rain: play("rain.mp3") } });
    expect(
      planAudioActions(
        before,
        view({ instances: { rain: { kind: "stop", fadeMs: 0 } } }),
      ),
    ).toEqual([]);
    expect(
      planAudioActions(
        before,
        view({ instances: { rain: paused(), wind: play("w.mp3") } }),
      ),
    ).toEqual([{ type: "pauseInstance", instanceId: "rain" }]);
    // 实例整体消失（表被清空）：同样只收通道动作，这里没有任何通道变化
    expect(planAudioActions(before, view({ instances: {} }))).toEqual([]);
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

describe("渲染器 · 实例暂停", () => {
  it("引擎暂停把在播实例转成 pauseInstance，恢复转成 resumeInstance", () => {
    const engine = makeStoryEngine(TWO_INSTANCES);
    const { port, instanceCalls } = makePort(true);
    const renderer = createAudioRenderer(engine, port, resources);
    try {
      engine.start();
      expect(instanceCalls).toEqual([]);

      engine.pause();
      expect(instanceCalls).toEqual([
        { kind: "pause", instanceId: "rain" },
        { kind: "pause", instanceId: "wind" },
      ]);

      instanceCalls.length = 0;
      engine.resume();
      expect(instanceCalls).toEqual([
        { kind: "resume", instanceId: "rain" },
        { kind: "resume", instanceId: "wind" },
      ]);
    } finally {
      renderer.dispose();
      engine.dispose();
    }
  });

  it("端口没有实例暂停能力：静默跳过，不抛错、不挡住通道动作", () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "bgm.mp3", volume: 0.5 },
      ...TWO_INSTANCES,
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
