/**
 * 音量三级解析：命令显式值 ?? 工程默认（`project.json` 的 `shell.audio.volumes`）?? 1。
 *
 * 为什么这一层值得单独立判据：音量在今天有四个来源（命令、工程默认、内建 1、玩家偏好），
 * 它们**不是同层相乘**——偏好是渲染层最外层的乘算，工程默认与命令才是引擎层的取值。
 * 顺序一旦写反，症状极隐蔽：换个工程，玩家的音量设置被作者的默认值顶掉。
 *
 * 四组判据：
 * - 取值链：未指定取工程默认 / 无默认取 1 / 显式覆盖默认
 * - 分通道：四通道各取自己的默认，不许串味
 * - 视频族：没有工程默认级（视频音量只认命令与 1）
 * - 组装期：畸形 fail-closed 报位置，越界钳制不拒绝
 *
 * 偏好乘算不在这里测（归渲染层，见 `tests/ui/audio/`）：本文件锁的是引擎层那三级。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannel,
  AudioChannelState,
  AudioConfig,
  OutboundEvent,
  ValueChanged,
} from "@lingfan-engine/core";
import {
  assembleProject,
  DEFAULT_AUDIO_CONFIG,
  parseStory,
  resolveAudioConfig,
  StoryEngine,
} from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  changes: ValueChanged[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const errors: OutboundEvent[] = [];
  const changes: ValueChanged[] = [];
  const offEvent = engine.onEvent((e) => errors.push(e));
  const offState = engine.onStateChanged((c) => changes.push(c));
  return {
    engine,
    errors,
    changes,
    dispose: () => {
      offEvent();
      offState();
    },
  };
}

/** 造一个只跑给定命令的引擎；`audioConfig` 省略即「没有工程默认」。 */
function makeEngine(commands: object[], audioConfig?: AudioConfig): Harness {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "volume",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    audioConfig === undefined ? { rngSeed: 7 } : { rngSeed: 7, audioConfig },
  );
  const harness = instrument(engine);
  engine.start();
  return harness;
}

function config(volumes: Partial<Record<AudioChannel, number>>): AudioConfig {
  return { volumes: { ...DEFAULT_AUDIO_CONFIG.volumes, ...volumes } };
}

function channelOf(engine: StoryEngine, key: string): AudioChannelState | null {
  return (engine.get(key) ?? null) as AudioChannelState | null;
}

function errorCodes(errors: OutboundEvent[]): string[] {
  const codes: string[] = [];
  for (const event of errors) {
    if (event.payload.kind === "engine.error") codes.push(event.payload.code);
  }
  return codes;
}

describe("音量三级解析 · 取值链", () => {
  it("命令没写 volume 就取工程默认（不是内建 1）", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "bgm", resource: "main.mp3" },
        { op: "ambient", resource: "rain.mp3", volume: 0.9 },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.6 }),
    );
    const bgm = channelOf(engine, "__audio_bgm");
    const ambient = channelOf(engine, "__audio_ambient");
    expect(bgm?.kind === "play" ? bgm.volume : null).toBeCloseTo(0.6, 6);
    // 显式值压过工程默认：同一次运行里两种来源并存，互不干扰
    expect(ambient?.kind === "play" ? ambient.volume : null).toBeCloseTo(
      0.9,
      6,
    );
    dispose();
  });

  it("没有工程默认时仍是内建 1（与既有行为逐字节一致）", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "main.mp3" },
      { op: "say", text: "停在这里看状态" },
    ]);
    const bgm = channelOf(engine, "__audio_bgm");
    expect(bgm?.kind === "play" ? bgm.volume : null).toBe(1);
    dispose();
  });

  it("显式 volume 覆盖工程默认（含显式 0：0 是值不是缺席）", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "bgm", resource: "main.mp3", volume: 0.3 },
        { op: "se", resource: "click.mp3", volume: 0 },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.6, se: 0.6 }),
    );
    const bgm = channelOf(engine, "__audio_bgm");
    const se = channelOf(engine, "__audio_se");
    expect(bgm?.kind === "play" ? bgm.volume : null).toBeCloseTo(0.3, 6);
    expect(se?.kind === "play" ? se.volume : null).toBe(0);
    dispose();
  });
});

describe("音量三级解析 · 分通道", () => {
  it("四通道各取自己的工程默认，不许串味", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "bgm", resource: "bgm.mp3" },
        { op: "ambient", resource: "rain.mp3" },
        { op: "voice", resource: "line.mp3" },
        { op: "se", resource: "click.mp3" },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.2, se: 0.3, ambient: 0.4, voice: 0.5 }),
    );
    const read = (key: string): number => {
      const state = channelOf(engine, key);
      return state?.kind === "play" ? state.volume : -1;
    };
    expect(read("__audio_bgm")).toBeCloseTo(0.2, 6);
    expect(read("__audio_se")).toBeCloseTo(0.3, 6);
    expect(read("__audio_ambient")).toBeCloseTo(0.4, 6);
    expect(read("__audio_voice")).toBeCloseTo(0.5, 6);
    dispose();
  });

  it("同一个命令重复执行仍按默认取值（状态改写不污染默认）", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "bgm", resource: "a.mp3" },
        { op: "bgm", resource: "a.mp3" },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.35 }),
    );
    const bgm = channelOf(engine, "__audio_bgm");
    expect(bgm?.kind === "play" ? bgm.volume : null).toBeCloseTo(0.35, 6);
    dispose();
  });
});

describe("音量三级解析 · 视频族没有工程默认级", () => {
  it("video 不写 volume 仍是 1（不是工程 bgm 默认）", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "video", resource: "op.mp4" },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.25 }),
    );
    const video = engine.get("__video") as { kind: string; volume?: number };
    expect(video.kind).toBe("play");
    expect(video.volume).toBe(1);
    dispose();
  });
});

describe("音量三级解析 · 组装期 fail-closed", () => {
  const manifest = (audio: unknown): unknown => ({
    formatVersion: 1,
    id: "p",
    entry: "start",
    shell: { audio },
  });
  const files = new Map<string, string>([
    [
      "Stories/start.json",
      JSON.stringify({
        formatVersion: 1,
        id: "start",
        kind: "flow",
        commands: [{ op: "say", text: "hi" }],
      }),
    ],
  ]);

  it("volumes 里的非有限数报出通道位置", () => {
    expect(() =>
      assembleProject(manifest({ volumes: { bgm: "0.5" } }), files),
    ).toThrow(/shell\.audio\.volumes\.bgm 必须为 0\.\.1 的有限数字/);
  });

  it("volumes 不是对象就拒绝（数组也不行）", () => {
    expect(() => assembleProject(manifest({ volumes: [1, 2] }), files)).toThrow(
      /shell\.audio\.volumes 必须为对象/,
    );
  });

  it("audio 不是对象就拒绝", () => {
    expect(() => assembleProject(manifest("loud"), files)).toThrow(
      /shell\.audio 必须为对象/,
    );
  });

  it("越界值不拒绝：解析时钳制后采纳", () => {
    const story = assembleProject(
      manifest({ volumes: { bgm: 1.5, se: -3 } }),
      files,
    );
    expect(story.id).toBe("p");
    const resolved = resolveAudioConfig(
      manifest({ volumes: { bgm: 1.5, se: -3 } }),
    );
    expect(resolved.volumes.bgm).toBe(1);
    expect(resolved.volumes.se).toBe(0);
    // 没写的通道保留内建默认，不被越界值连坐
    expect(resolved.volumes.ambient).toBe(1);
    expect(resolved.volumes.voice).toBe(1);
  });

  it("解析器对畸形清单不抛，回内建默认", () => {
    expect(resolveAudioConfig(null).volumes).toEqual(
      DEFAULT_AUDIO_CONFIG.volumes,
    );
    expect(resolveAudioConfig({ shell: "x" }).volumes).toEqual(
      DEFAULT_AUDIO_CONFIG.volumes,
    );
    expect(
      resolveAudioConfig({ shell: { audio: { volumes: 3 } } }).volumes,
    ).toEqual(DEFAULT_AUDIO_CONFIG.volumes);
  });
});

describe("音量三级解析 · 与渲染层的分工", () => {
  it("引擎不读玩家偏好：同一份状态在两种偏好下取到同一个值", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "bgm", resource: "main.mp3" },
        { op: "say", text: "停在这里看状态" },
      ],
      config({ bgm: 0.4 }),
    );
    const bgm = channelOf(engine, "__audio_bgm");
    expect(bgm?.kind === "play" ? bgm.volume : null).toBeCloseTo(0.4, 6);
    // 状态里既没有「有效音量」也没有偏好字段：偏好只活在渲染层
    const keys = Object.keys(engine.get("__audio_bgm") as object);
    expect(keys.sort()).toEqual(
      ["fadeMs", "kind", "loop", "resource", "volume"].sort(),
    );
    dispose();
  });

  it("非法显式音量 fail-closed 且状态不变（默认值也不接管）", () => {
    // 写坏的那一条不许被「工程默认」悄悄救活：显式值非法 = 作者的错，
    // 报错并保持状态原样（通道仍是 null），不能拿默认值顶上装作没事。
    const { engine, errors, dispose } = makeEngine(
      [
        { op: "bgm", resource: "a.mp3", volume: "loud" },
        { op: "say", text: "第一句" },
      ],
      config({ bgm: 0.5 }),
    );
    expect(errorCodes(errors)).toContain("bgm-invalid-volume");
    expect(channelOf(engine, "__audio_bgm")).toBeNull();
    dispose();
  });
});
