/**
 * `audio_pause` / `audio_resume` 执行语义：三态写回、幂等、通道展开、se 不参与。
 * 断言只看状态与序号，不碰端口（执行期不直接驱动播放器）。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  OutboundEvent,
  ValueChanged,
} from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
    },
  };
}

function makeEngine(commands: object[]): Harness {
  return instrument(
    new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "audio-pause",
        columns: [{ id: "start", kind: "flow", commands }],
      }),
      { rngSeed: 5 },
    ),
  );
}

function channel(engine: StoryEngine, key: string): AudioChannelState | null {
  return (engine.get(key) ?? null) as AudioChannelState | null;
}

function hasError(errors: OutboundEvent[], code: string): boolean {
  return errors.some(
    (e) => e.payload.kind === "engine.error" && e.payload.code === code,
  );
}

describe("audio_pause / audio_resume 执行语义", () => {
  it("audio_pause bgm：play 态变 pause 态并领序号", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3", volume: 0.5 },
      { op: "audio_pause", channel: "bgm" },
      { op: "say", text: "停" },
    ]);
    try {
      engine.start();
      const state = channel(engine, SYS.audioBgm);
      expect(state).toMatchObject({ kind: "pause" });
      // pause 态不带资源：资源与位置留在端口的播放器实例里
      expect(state).not.toHaveProperty("resource");
      expect(typeof (state as { seq?: number }).seq).toBe("number");
    } finally {
      dispose();
    }
  });

  it("audio_resume bgm：写回暂停前的同一个 play 态（资源/音量/循环原样）", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3", volume: 0.4, loop: false, fade: 300 },
      { op: "audio_pause", channel: "bgm" },
      { op: "audio_resume", channel: "bgm" },
      { op: "say", text: "续" },
    ]);
    try {
      engine.start();
      expect(channel(engine, SYS.audioBgm)).toEqual({
        kind: "play",
        resource: "a.mp3",
        volume: 0.4,
        loop: false,
        fadeMs: 300,
      });
    } finally {
      dispose();
    }
  });

  it("不传 channel：暂停全部常驻通道（bgm / ambient / voice），se 不动", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "ambient", resource: "rain.mp3" },
      { op: "voice", resource: "v.mp3" },
      { op: "se", resource: "hit.mp3" },
      { op: "audio_pause" },
      { op: "say", text: "全停" },
    ]);
    try {
      engine.start();
      for (const key of [SYS.audioBgm, SYS.audioAmbient, SYS.audioVoice]) {
        expect(channel(engine, key)?.kind).toBe("pause");
      }
      // se 是一次性触发：没有「暂停后从原位置继续」这回事
      expect(channel(engine, SYS.audioSe)).toMatchObject({
        kind: "play",
        resource: "hit.mp3",
      });
    } finally {
      dispose();
    }
  });

  it("显式 channel=se：静默不动作（既不报错也不改状态）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "se", resource: "hit.mp3" },
      { op: "audio_pause", channel: "se" },
      { op: "audio_resume", channel: "se" },
      { op: "say", text: "尾" },
    ]);
    try {
      engine.start();
      expect(channel(engine, SYS.audioSe)).toMatchObject({
        kind: "play",
        resource: "hit.mp3",
      });
      expect(errors).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("幂等：连续两次暂停只有第一次改状态，序号不重复递增", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "audio_pause", channel: "bgm" },
      { op: "audio_pause", channel: "bgm" },
      { op: "say", text: "一" },
    ]);
    try {
      engine.start();
      const first = channel(engine, SYS.audioBgm);
      expect(first?.kind).toBe("pause");

      // 再推一次同样的暂停：状态与序号都不变（没有新事件）
      engine.advance();
      expect(channel(engine, SYS.audioBgm)).toEqual(first);
    } finally {
      dispose();
    }
  });

  it("恢复非暂停通道 / 暂停未播放通道：空操作，不凭空造 play 态", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "audio_pause", channel: "voice" },
      { op: "audio_resume", channel: "ambient" },
      { op: "say", text: "尾" },
    ]);
    try {
      engine.start();
      expect(channel(engine, SYS.audioVoice)).toBeNull();
      expect(channel(engine, SYS.audioAmbient)).toBeNull();
      expect(errors).toEqual([]);
    } finally {
      dispose();
    }
  });

  it("非法 channel → audio_pause-invalid-channel，且状态不变", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "audio_pause", channel: "bgm2" },
      { op: "say", text: "尾" },
    ]);
    try {
      engine.start();
      expect(hasError(errors, "audio_pause-invalid-channel")).toBe(true);
      expect(channel(engine, SYS.audioBgm)).toMatchObject({
        kind: "play",
        resource: "a.mp3",
      });
    } finally {
      dispose();
    }
  });
});
