/**
 * 08-U6 四音频通道核心语义测试（规约↔测试互锁锚点）：
 * four-audio-channels（四通道独立音量）/ media-state-in-snapshot（03-R7）/
 * 05 §四 媒体进档（读档续播）/ E3 fail-closed（非法负载拒绝后状态不变）。
 * 测试纪律五类：拟态用户旅程、故意错误、不变量、边界、回归锚定（见 journey.test.ts 音频旅程）。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  OutboundEvent,
  SaveDataV1,
  ValueChanged,
} from "../contracts";
import { SYS } from "../contracts";
import { StoryEngine } from "./engine";
import { parseStory } from "../data";

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
        id: "audio",
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

/** 音频系统键快照（对抗性用例断言「拒绝后状态不变」） */
function audioKeys(engine: StoryEngine): unknown[] {
  return [
    engine.get(SYS.audioBgm),
    engine.get(SYS.audioAmbient),
    engine.get(SYS.audioVoice),
    engine.get(SYS.audioSe),
    engine.get(SYS.bgmPosition),
  ];
}

describe("08-U6 四音频通道（锚点: four-audio-channels）", () => {
  it("四通道各自独立音量：改一路不扰其余", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "bgm.mp3", volume: 0.3 },
      { op: "ambient", resource: "rain.mp3", volume: 0.7 },
      { op: "voice", resource: "line.mp3", volume: 0.9 },
      { op: "se", resource: "click.mp3", volume: 0.2 },
      { op: "say", text: "四路齐鸣" },
    ]);
    engine.start();

    expect(channel(engine, SYS.audioBgm)).toMatchObject({
      kind: "play",
      resource: "bgm.mp3",
      volume: 0.3,
      loop: true,
    });
    expect(channel(engine, SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
      volume: 0.7,
      loop: true,
    });
    expect(channel(engine, SYS.audioVoice)).toMatchObject({
      resource: "line.mp3",
      volume: 0.9,
      loop: false,
      autoStop: true,
    });
    expect(channel(engine, SYS.audioSe)).toMatchObject({
      resource: "click.mp3",
      volume: 0.2,
      loop: false,
    });
    // 独立：改 ambient 不动 bgm/voice
    engine.advance();
    const again = makeEngine([
      { op: "ambient", resource: "wind.mp3", volume: 0.1 },
      { op: "say", text: "x" },
    ]);
    again.engine.start();
    expect(channel(again.engine, SYS.audioAmbient)).toMatchObject({
      resource: "wind.mp3",
      volume: 0.1,
    });
    expect(again.engine.get(SYS.audioBgm)).toBeUndefined();
  });

  it("缺省负载：bgm/ambient 循环、voice 非循环、音量 1、无淡入", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "voice", resource: "v.mp3" },
      { op: "say", text: "x" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioBgm)).toEqual({
      kind: "play",
      resource: "a.mp3",
      volume: 1,
      loop: true,
      fadeMs: 0,
    });
    expect(channel(engine, SYS.audioVoice)).toEqual({
      kind: "play",
      resource: "v.mp3",
      volume: 1,
      loop: false,
      fadeMs: 0,
      autoStop: true,
    });
  });

  it("se 一次性触发：同一资源连续两次得到不同触发序号", () => {
    const { engine, changes } = makeEngine([
      { op: "se", resource: "step.mp3" },
      { op: "se", resource: "step.mp3" },
      { op: "say", text: "x" },
    ]);
    engine.start();
    // 触发是离散事件：同一资源两次执行必须各出一次状态变更（seq 递增，不被值相同吞掉）
    const seValues = changes
      .filter((c) => c.key === SYS.audioSe)
      .map((c) => c.value as AudioChannelState);
    expect(seValues).toHaveLength(2);
    expect(seValues[0]).toMatchObject({ resource: "step.mp3", seq: 1 });
    expect(seValues[1]).toMatchObject({ resource: "step.mp3", seq: 2 });
  });

  it("voice 单槽互斥：新语音替换旧语音（通道恒单值）", () => {
    const { engine } = makeEngine([
      { op: "voice", resource: "a.mp3" },
      { op: "voice", resource: "b.mp3" },
      { op: "say", text: "x" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioVoice)).toMatchObject({
      resource: "b.mp3",
    });
  });
});

describe("03-R7 媒体位置随快照（锚点: media-state-in-snapshot）", () => {
  it("同曲续播、换曲归零：bgm 重写同资源不打断播放位置", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "say", text: "一" },
      { op: "bgm", resource: "a.mp3", volume: 0.5 },
      { op: "say", text: "二" },
      { op: "bgm", resource: "b.mp3" },
      { op: "say", text: "三" },
    ]);
    engine.start();
    engine.reportMediaPosition(20);
    engine.advance(); // 同曲重写（音量变）→ 位置保持
    expect(channel(engine, SYS.audioBgm)).toMatchObject({
      resource: "a.mp3",
      volume: 0.5,
    });
    expect(engine.get(SYS.bgmPosition)).toBe(20);
    engine.advance(); // 换曲 → 位置归零
    expect(channel(engine, SYS.audioBgm)).toMatchObject({ resource: "b.mp3" });
    expect(engine.get(SYS.bgmPosition)).toBe(0);
  });

  it("回溯恢复曲目与播放位置（快照含媒体状态）", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "say", text: "一" },
      { op: "say", text: "二" },
      { op: "say", text: "三" },
    ]);
    engine.start(); // say 一：快照 pos 0
    engine.reportMediaPosition(12);
    engine.advance(); // 提交 cp0；say 二 的快照捕获 pos 12
    engine.reportMediaPosition(30);
    engine.advance(); // 提交 cp1（pos 12）；say 三 的快照捕获 pos 30
    expect(engine.get(SYS.bgmPosition)).toBe(30);

    engine.rollbackTo(1);
    expect(engine.get(SYS.bgmPosition)).toBe(12);
    expect(channel(engine, SYS.audioBgm)).toEqual({
      kind: "play",
      resource: "a.mp3",
      volume: 1,
      loop: true,
      fadeMs: 0,
    });
  });

  it("reportMediaPosition 静默回写：帧级键不进事件流（U2）", () => {
    const { engine, changes } = makeEngine([{ op: "say", text: "一" }]);
    engine.start();
    changes.length = 0;
    engine.reportMediaPosition(7.5);
    expect(engine.get(SYS.bgmPosition)).toBe(7.5);
    expect(changes.some((c) => c.key === SYS.bgmPosition)).toBe(false);
  });

  it("stop_ambient / stop_voice 写停止形态并保留淡出参数", () => {
    const { engine } = makeEngine([
      { op: "ambient", resource: "rain.mp3" },
      { op: "voice", resource: "v.mp3" },
      { op: "stop_ambient", fade: 400 },
      { op: "stop_voice" },
      { op: "say", text: "x" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioAmbient)).toEqual({
      kind: "stop",
      fadeMs: 400,
    });
    expect(channel(engine, SYS.audioVoice)).toEqual({
      kind: "stop",
      fadeMs: 0,
    });
  });

  it('stop_bgm 停背景乐并把播放位置归零（老引擎 `bgm ""` 语义的显式化）', () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "main.mp3" },
      { op: "say", text: "一" },
      { op: "stop_bgm", fade: 800 },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.reportMediaPosition(30);
    expect(engine.get(SYS.bgmPosition)).toBe(30);
    engine.advance();
    expect(channel(engine, SYS.audioBgm)).toEqual({
      kind: "stop",
      fadeMs: 800,
    });
    expect(engine.get(SYS.bgmPosition)).toBe(0);
  });
});

describe("05 §四 媒体进档（读档续播）", () => {
  it("exportSave 携带媒体状态；importSave 恢复曲目与位置", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a.mp3", volume: 0.4 },
      { op: "say", text: "一" },
      { op: "bgm", resource: "b.mp3", volume: 0.6 },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.reportMediaPosition(12);
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    const keys = new Map(data!.state);
    expect(keys.get(SYS.audioBgm)).toMatchObject({ resource: "a.mp3" });
    expect(keys.get(SYS.bgmPosition)).toBe(12);

    engine.advance(); // 换曲 b：媒体状态被改写
    expect(channel(engine, SYS.audioBgm)).toMatchObject({ resource: "b.mp3" });

    // 跨 JSON 序列化往返（真实存档路径）
    const ok = engine.importSave(
      JSON.parse(JSON.stringify(data)) as SaveDataV1,
    );
    expect(ok).toBe(true);
    expect(channel(engine, SYS.audioBgm)).toMatchObject({
      resource: "a.mp3",
      volume: 0.4,
    });
    expect(engine.get(SYS.bgmPosition)).toBe(12);
  });
});

describe("voice auto_stop（08 §六.1）", () => {
  it("say 的 voice 参数绑定本句语音；推进过该句自动停止", () => {
    const { engine } = makeEngine([
      { op: "say", text: "一", voice: "line1.mp3" },
      { op: "say", text: "二" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioVoice)).toMatchObject({
      resource: "line1.mp3",
      autoStop: true,
    });
    engine.advance();
    expect(channel(engine, SYS.audioVoice)).toEqual({
      kind: "stop",
      fadeMs: 0,
    });
  });

  it("auto_stop=false 的语音在推进后保留", () => {
    const { engine } = makeEngine([
      { op: "voice", resource: "bg_voice.mp3", auto_stop: false },
      { op: "say", text: "一" },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.advance();
    expect(channel(engine, SYS.audioVoice)).toMatchObject({
      resource: "bg_voice.mp3",
      autoStop: false,
    });
  });
});

describe("显式重播 restart（08 §六.1；同曲默认无缝续播）", () => {
  it("同曲 restart 归零位置并标记重播；非 restart 保持位置", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a.mp3" },
      { op: "say", text: "一" },
      { op: "bgm", resource: "a.mp3" },
      { op: "say", text: "二" },
      { op: "bgm", resource: "a.mp3", restart: true },
      { op: "say", text: "三" },
    ]);
    engine.start();
    engine.reportMediaPosition(20);
    engine.advance(); // 同曲无 restart：无缝续播
    expect(engine.get(SYS.bgmPosition)).toBe(20);
    expect(channel(engine, SYS.audioBgm)).not.toHaveProperty("restart");

    engine.advance(); // 同曲 restart：回到起点
    expect(engine.get(SYS.bgmPosition)).toBe(0);
    const state = channel(engine, SYS.audioBgm);
    expect(state).toMatchObject({
      kind: "play",
      resource: "a.mp3",
      restart: true,
    });
    expect(state?.kind === "play" ? state.seq : undefined).toBeGreaterThan(0);
  });

  it("同曲连续两次 restart 得到不同序号（两次独立重播，不被值相同吞掉）", () => {
    const { engine, changes } = makeEngine([
      { op: "bgm", resource: "a.mp3", restart: true },
      { op: "say", text: "一" },
      { op: "bgm", resource: "a.mp3", restart: true },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.advance();
    const seqs = changes
      .filter((c) => c.key === SYS.audioBgm)
      .map((c) => (c.value as { seq?: number }).seq);
    expect(seqs).toHaveLength(2);
    expect(seqs[0]).not.toBe(seqs[1]);
  });

  it("voice / ambient 同样支持 restart（单槽替换 + 重播序号）", () => {
    const { engine } = makeEngine([
      { op: "voice", resource: "v.mp3" },
      { op: "ambient", resource: "rain.mp3" },
      { op: "say", text: "一" },
      { op: "voice", resource: "v.mp3", restart: true },
      { op: "ambient", resource: "rain.mp3", restart: true },
      { op: "say", text: "二" },
    ]);
    engine.start();
    engine.advance();
    expect(channel(engine, SYS.audioVoice)).toMatchObject({
      resource: "v.mp3",
      restart: true,
    });
    expect(channel(engine, SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
      restart: true,
    });
  });
});

describe("对抗性注入（fail-closed；拒绝后音频状态保持原样）", () => {
  const cases: Array<{ name: string; cmd: object; code: string }> = [
    {
      name: "resource 非字符串",
      cmd: { op: "bgm", resource: 42 },
      code: "bgm-invalid-resource",
    },
    {
      name: "resource 空串",
      cmd: { op: "se", resource: "" },
      code: "se-invalid-resource",
    },
    {
      name: "resource 缺失",
      cmd: { op: "ambient" },
      code: "ambient-invalid-resource",
    },
    {
      name: "volume 字符串",
      cmd: { op: "bgm", resource: "a", volume: "大" },
      code: "bgm-invalid-volume",
    },
    {
      name: "volume NaN",
      cmd: { op: "ambient", resource: "a", volume: NaN },
      code: "ambient-invalid-volume",
    },
    {
      name: "volume Infinity",
      cmd: { op: "voice", resource: "a", volume: Infinity },
      code: "voice-invalid-volume",
    },
    {
      name: "fade 负数",
      cmd: { op: "stop_ambient", fade: -5 },
      code: "stop_ambient-invalid-fade",
    },
    {
      name: "fade 非数字",
      cmd: { op: "stop_voice", fade: {} },
      code: "stop_voice-invalid-fade",
    },
    {
      name: "未知字段（幽灵音量键）",
      cmd: { op: "bgm", resource: "a", 音量: 1 },
      code: "bgm-unknown-field",
    },
    {
      name: "se 夹带 loop",
      cmd: { op: "se", resource: "a", loop: true },
      code: "se-unknown-field",
    },
    {
      name: "se 夹带 restart（一次性音效恒重播）",
      cmd: { op: "se", resource: "a", restart: true },
      code: "se-unknown-field",
    },
    {
      name: "voice 夹带 fade",
      cmd: { op: "voice", resource: "a", fade: 1 },
      code: "voice-unknown-field",
    },
    {
      name: "bgm 夹带 auto_stop",
      cmd: { op: "bgm", resource: "a", auto_stop: true },
      code: "bgm-unknown-field",
    },
    {
      name: "stop_bgm 夹带 resource",
      cmd: { op: "stop_bgm", resource: "a" },
      code: "stop_bgm-unknown-field",
    },
  ];

  for (const { name, cmd, code } of cases) {
    it(`${name} → fail-closed 且音频状态不变`, () => {
      const { engine, errors } = makeEngine([
        { op: "bgm", resource: "keep.mp3" },
        cmd,
        { op: "say", text: "不应到达" },
      ]);
      engine.start();
      expect(hasError(errors, code)).toBe(true);
      // 拒绝后：前一条合法命令的媒体状态保持原样，且未推进到 say（fail-closed 停机）
      expect(channel(engine, SYS.audioBgm)).toMatchObject({
        resource: "keep.mp3",
      });
      expect(engine.get(SYS.waiting)).not.toBe("dialog");
      expect(engine.get(SYS.audioSe)).toBeUndefined();
    });
  }

  it("首条即非法：音频键全未写入（无半恢复）", () => {
    const { engine, errors } = makeEngine([
      { op: "bgm", resource: 0 },
      { op: "say", text: "x" },
    ]);
    const before = audioKeys(engine);
    engine.start();
    expect(hasError(errors, "bgm-invalid-resource")).toBe(true);
    expect(audioKeys(engine)).toEqual(before);
  });
});

describe("边界条件", () => {
  it("volume 越界按物理范围钳制（0..1）", () => {
    const { engine } = makeEngine([
      { op: "bgm", resource: "a", volume: -3 },
      { op: "ambient", resource: "b", volume: 5 },
      { op: "say", text: "x" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioBgm)).toMatchObject({ volume: 0 });
    expect(channel(engine, SYS.audioAmbient)).toMatchObject({ volume: 1 });
  });

  it("非法播放位置回写被忽略（不污染快照/存档）", () => {
    const { engine } = makeEngine([{ op: "say", text: "x" }]);
    engine.start();
    engine.reportMediaPosition(3);
    for (const bad of [NaN, Infinity, -1, -0.001]) {
      engine.reportMediaPosition(bad);
    }
    expect(engine.get(SYS.bgmPosition)).toBe(3);
  });

  it("stop 缺省 fade=0；空列不写任何媒体键", () => {
    const { engine } = makeEngine([
      { op: "stop_voice" },
      { op: "say", text: "x" },
    ]);
    engine.start();
    expect(channel(engine, SYS.audioVoice)).toEqual({
      kind: "stop",
      fadeMs: 0,
    });
    const empty = makeEngine([]);
    empty.engine.start();
    expect(audioKeys(empty.engine)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
