/**
 * 媒体族对称：实例 op 面补齐、通道级音量 / 定位、视频同资源续播、快照随行。
 *
 * 判据按「族内口径一致」组织：
 * - 实例 pause/resume 与通道 pause/resume 同语义（记账、幂等、恢复不重播）。
 * - 通道级 volume 只改音量不动序号；seek 只移位置，保留资源与音量。
 * - 视频同资源重写默认续播（序号不变），restart / 换资源才重播；过场恒重播。
 * - se 是一次性通道：无暂停 / 定位语义，显式 targeting 时静默跳过（族对称的例外）。
 * - 定位与续播状态进快照：回溯回到历史位，读档原样恢复。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  AudioInstanceTable,
  OutboundEvent,
  SaveDataV1,
  Story,
  VideoCommand,
} from "@lingfan-engine/core";
import { parseStory, StoryEngine, SYS } from "@lingfan-engine/core";

function makeStory(commands: object[]): Story {
  return parseStory({
    formatVersion: 1,
    id: "media-symmetry",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  dispose: () => void;
}

function makeEngine(commands: object[]): Harness {
  const errors: OutboundEvent[] = [];
  const engine = new StoryEngine(makeStory(commands), { rngSeed: 3 });
  const off = engine.onEvent((e) => errors.push(e));
  engine.start();
  return {
    engine,
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload as { code: string }).code);
}

function channel(
  engine: StoryEngine,
  key: string,
): AudioChannelState | undefined {
  return engine.get(key) as AudioChannelState | undefined;
}

function instanceTable(engine: StoryEngine): AudioInstanceTable {
  return (engine.get(SYS.audioInstances) ?? {}) as AudioInstanceTable;
}

function videoSeq(engine: StoryEngine): number | undefined {
  return (engine.get(SYS.video) as VideoCommand | undefined)?.seq;
}

const TAIL = { op: "say", text: "停在这里看状态" };
const PLAY_RAIN = {
  op: "audio_play",
  inst: "rain",
  channel: "ambient",
  resource: "rain.mp3",
};

describe("实例 op 面：pause / resume 与通道同语义", () => {
  it("audio-instance-params：inst 暂停单个实例并记账，恢复接着播", () => {
    const { engine, errors, dispose } = makeEngine([
      PLAY_RAIN,
      { op: "audio_pause", inst: "rain" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    expect(instanceTable(engine).rain?.state.kind).toBe("pause");
    const paused = engine.get(SYS.audioPaused) as Record<
      string,
      AudioChannelState
    >;
    expect(paused["inst:rain"]?.kind).toBe("play");
    dispose();

    const resumed = makeEngine([
      PLAY_RAIN,
      { op: "audio_pause", inst: "rain" },
      { op: "audio_resume", inst: "rain" },
      TAIL,
    ]);
    expect(errorCodes(resumed.errors)).toHaveLength(0);
    expect(instanceTable(resumed.engine).rain?.state.kind).toBe("play");
    const after = resumed.engine.get(SYS.audioPaused) as Record<
      string,
      AudioChannelState
    >;
    expect(after["inst:rain"]).toBeUndefined();
    resumed.dispose();
  });

  it("audio-instance-params：inst 与 channel 互斥装载期拒绝，未知实例运行期拒绝", () => {
    expect(() =>
      makeEngine([
        PLAY_RAIN,
        { op: "audio_pause", inst: "rain", channel: "bgm" },
        TAIL,
      ]),
    ).toThrow(/inst 与 channel 互斥/);

    const unknown = makeEngine([{ op: "audio_pause", inst: "nope" }, TAIL]);
    expect(errorCodes(unknown.errors)).toContain(
      "audio_pause-unknown-instance",
    );
    unknown.dispose();
  });
});

describe("通道级音量与定位", () => {
  it("channel-volume-seek：通道调音量只改值不动序号", () => {
    const { engine, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      TAIL,
    ]);
    const before = channel(engine, SYS.audioBgm);
    dispose();

    const h = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "audio_volume", channel: "bgm", volume: 0.3 },
      TAIL,
    ]);
    expect(errorCodes(h.errors)).toHaveLength(0);
    const after = channel(h.engine, SYS.audioBgm);
    expect(after?.kind).toBe("play");
    if (after?.kind === "play") {
      expect(after.volume).toBe(0.3);
      expect(after.seq).toBe(before?.kind === "play" ? before.seq : undefined);
    }
    h.dispose();
  });

  it("channel-volume-seek：通道 seek 移位置保留资源，bgm 位置同步", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "audio_seek", channel: "bgm", seconds: 30 },
      TAIL,
    ]);
    expect(errorCodes(errors)).toHaveLength(0);
    const state = channel(engine, SYS.audioBgm);
    expect(state?.kind).toBe("play");
    if (state?.kind === "play") {
      expect(state.resource).toBe("a.mp3");
      expect(state.position).toBe(30);
      expect(state.restart).toBe(false);
    }
    expect(engine.get(SYS.bgmPosition)).toBe(30);
    dispose();
  });

  it("channel-volume-seek：实例 seek 写位置；se 显式 targeting 静默", () => {
    const h = makeEngine([
      PLAY_RAIN,
      { op: "audio_seek", inst: "rain", seconds: 12 },
      { op: "audio_seek", channel: "se", seconds: 5 },
      { op: "audio_volume", channel: "se", volume: 0.2 },
      TAIL,
    ]);
    expect(errorCodes(h.errors)).toHaveLength(0);
    const rain = instanceTable(h.engine).rain?.state;
    expect(rain?.kind).toBe("play");
    if (rain?.kind === "play") expect(rain.position).toBe(12);
    h.dispose();
  });

  it("channel-volume-seek：未在播放的通道 seek 拒绝（fail-closed）", () => {
    const h = makeEngine([
      { op: "audio_seek", channel: "bgm", seconds: 30 },
      TAIL,
    ]);
    expect(errorCodes(h.errors)).toContain("audio_seek-channel-stopped");
    h.dispose();
  });
});

describe("视频同资源续播", () => {
  it("video-same-resource-resume：同资源重写序号不变，restart 才重播", () => {
    const first = makeEngine([{ op: "video", resource: "v.mp4" }, TAIL]);
    const seq1 = videoSeq(first.engine);
    first.dispose();

    const same = makeEngine([
      { op: "video", resource: "v.mp4" },
      { op: "video", resource: "v.mp4" },
      TAIL,
    ]);
    expect(videoSeq(same.engine)).toBe(seq1);
    same.dispose();

    const restarted = makeEngine([
      { op: "video", resource: "v.mp4" },
      { op: "video", resource: "v.mp4", restart: true },
      TAIL,
    ]);
    expect(videoSeq(restarted.engine)).not.toBe(seq1);
    restarted.dispose();

    const switched = makeEngine([
      { op: "video", resource: "v.mp4" },
      { op: "video", resource: "other.mp4" },
      TAIL,
    ]);
    expect(videoSeq(switched.engine)).not.toBe(seq1);
    switched.dispose();
  });

  it("video-same-resource-resume：过场每次起播序号恒递增（阻塞呈现例外）", () => {
    const h = makeEngine([
      { op: "cutscene", resource: "c.mp4" },
      { op: "cutscene", resource: "c.mp4" },
      TAIL,
    ]);
    const seq1 = videoSeq(h.engine);
    expect(h.engine.get(SYS.waiting)).toBe("video");
    h.engine.advance(); // 可跳过过场解除 → 同资源再过场仍领新序号
    expect(videoSeq(h.engine)).not.toBe(seq1);
    h.dispose();
  });
});

describe("媒体族对称：四通道 stop 一致，se 一次性例外", () => {
  it("media-family-symmetry：常驻通道可暂停，se 不参与暂停", () => {
    const h = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "ambient", resource: "b.mp3" },
      { op: "voice", resource: "c.mp3" },
      { op: "se", resource: "d.mp3" },
      { op: "audio_pause" },
      TAIL,
    ]);
    expect(errorCodes(h.errors)).toHaveLength(0);
    expect(channel(h.engine, SYS.audioBgm)?.kind).toBe("pause");
    expect(channel(h.engine, SYS.audioAmbient)?.kind).toBe("pause");
    expect(channel(h.engine, SYS.audioVoice)?.kind).toBe("pause");
    expect(channel(h.engine, SYS.audioSe)?.kind).toBe("play");
    h.dispose();
  });

  it("media-family-symmetry：四通道 stop_* 都落 stop 态", () => {
    const h = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "ambient", resource: "b.mp3" },
      { op: "voice", resource: "c.mp3" },
      { op: "se", resource: "d.mp3" },
      { op: "stop_bgm" },
      { op: "stop_ambient" },
      { op: "stop_voice" },
      { op: "stop_se" },
      TAIL,
    ]);
    expect(errorCodes(h.errors)).toHaveLength(0);
    expect(channel(h.engine, SYS.audioBgm)?.kind).toBe("stop");
    expect(channel(h.engine, SYS.audioAmbient)?.kind).toBe("stop");
    expect(channel(h.engine, SYS.audioVoice)?.kind).toBe("stop");
    expect(channel(h.engine, SYS.audioSe)?.kind).toBe("stop");
    h.dispose();
  });
});

describe("媒体位置进快照：回溯与读档", () => {
  const journey = [
    { op: "bgm", resource: "a.mp3" },
    { op: "say", text: "一" },
    { op: "audio_seek", channel: "bgm", seconds: 30 },
    { op: "say", text: "二" },
  ];

  it("media-state-snapshot：seek 后回溯回到历史位", () => {
    const { engine, dispose } = makeEngine(journey);
    engine.advance();
    expect(engine.get(SYS.bgmPosition)).toBe(30);
    engine.rollbackTo(0);
    expect(engine.get(SYS.bgmPosition)).toBe(0);
    const state = channel(engine, SYS.audioBgm);
    expect(state?.kind === "play" ? state.position : undefined).toBeUndefined();
    dispose();
  });

  it("media-state-snapshot：seek 位置随存档恢复", () => {
    const first = makeEngine(journey);
    first.engine.advance();
    const data = first.engine.exportSave();
    expect(data).not.toBeNull();
    first.dispose();

    const revived = makeEngine(journey);
    expect(
      revived.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    expect(revived.engine.get(SYS.bgmPosition)).toBe(30);
    const state = channel(revived.engine, SYS.audioBgm);
    expect(state?.kind === "play" ? state.position : undefined).toBe(30);
    revived.dispose();
  });
});
