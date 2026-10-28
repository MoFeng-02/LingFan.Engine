/**
 * 音频实例命令面：`audio_play` / `audio_stop` / `audio_volume`。
 *
 * 三条命令的分工本身就是判据：
 * - `audio_play` 创建或更新（同资源 = 更新，换资源 / `restart` = 重播）
 * - `audio_stop` 停一个，缺 `inst` 停全部
 * - `audio_volume` **只改音量**：不重播、不动位置、不递增序号
 *
 * 最后一件事最容易写错：给 `audio_volume` 也递增 `seq`，渲染层会把「调了个音量」
 * 当成一次新的起播，于是滑块拖到一半音乐从头开始。所以这里专门锁「调音量前后
 * `seq` 不变」，而不只锁音量值。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioInstanceTable,
  AudioInstanceState,
  OutboundEvent,
  Story,
} from "@lingfan-engine/core";
import {
  AUDIO_INSTANCE_ID_PATTERN,
  MAX_AUDIO_INSTANCES,
  parseStory,
  parseTextStory,
  projectText,
  SYS,
  StoryEngine,
} from "@lingfan-engine/core";

interface Harness {
  engine: StoryEngine;
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const errors: OutboundEvent[] = [];
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    errors,
    dispose: () => {
      offEvent();
      engine.dispose();
    },
  };
}

function makeStory(commands: object[]): Story {
  return parseStory({
    formatVersion: 1,
    id: "instances",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

function makeEngine(commands: object[]): Harness {
  const engine = new StoryEngine(makeStory(commands), { rngSeed: 3 });
  const harness = instrument(engine);
  engine.start();
  return harness;
}

function tableOf(engine: StoryEngine): AudioInstanceTable {
  return (engine.get(SYS.audioInstances) ?? {}) as AudioInstanceTable;
}

function instanceOf(
  engine: StoryEngine,
  id: string,
): AudioInstanceState | undefined {
  return tableOf(engine)[id];
}

function errorCodes(errors: OutboundEvent[]): string[] {
  const codes: string[] = [];
  for (const event of errors) {
    if (event.payload.kind === "engine.error") codes.push(event.payload.code);
  }
  return codes;
}

const TAIL = { op: "say", text: "停在这里看状态" };

describe("音频实例 · audio_play", () => {
  it("起播写进实例表：通道、资源、音量、循环都在", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "rain.ogg",
        volume: 0.3,
      },
      TAIL,
    ]);
    const entry = instanceOf(engine, "rain");
    expect(entry?.channel).toBe("ambient");
    expect(entry?.state.kind).toBe("play");
    if (entry?.state.kind === "play") {
      expect(entry.state.resource).toBe("rain.ogg");
      expect(entry.state.volume).toBeCloseTo(0.3, 6);
      expect(entry.state.loop).toBe(true); // 缺省循环，与 bgm/ambient 同口径
    }
    dispose();
  });

  it("没写 volume 时取该通道的工程默认（三级解析在实例上同样成立）", () => {
    const engine = new StoryEngine(
      makeStory([
        {
          op: "audio_play",
          inst: "rain",
          channel: "ambient",
          resource: "r.ogg",
        },
        TAIL,
      ]),
      {
        rngSeed: 3,
        audioConfig: { volumes: { bgm: 1, se: 1, ambient: 0.45, voice: 1 } },
      },
    );
    const harness = instrument(engine);
    engine.start();
    const entry = instanceOf(engine, "rain");
    const volume = entry?.state.kind === "play" ? entry.state.volume : null;
    expect(volume).toBeCloseTo(0.45, 6);
    harness.dispose();
  });

  it("同实例换资源就重播：seq 递增、资源替换", () => {
    const { engine, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "a.ogg" },
      TAIL,
    ]);
    const first = instanceOf(engine, "rain");
    const firstSeq = first?.state.kind === "play" ? first.state.seq : undefined;
    expect(firstSeq).toBeTypeOf("number");
    dispose();

    const second = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "a.ogg" },
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "b.ogg" },
      TAIL,
    ]);
    const entry = instanceOf(second.engine, "rain");
    expect(entry?.state.kind === "play" ? entry.state.resource : null).toBe(
      "b.ogg",
    );
    expect(
      entry?.state.kind === "play" ? entry.state.seq : undefined,
    ).toBeGreaterThan(firstSeq!);
    second.dispose();
  });

  it("同实例同资源 = 更新：不递增 seq（渲染层据此判定「没换曲」）", () => {
    const { engine, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "a.ogg" },
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "a.ogg" },
      TAIL,
    ]);
    const entry = instanceOf(engine, "rain");
    // 两次都是同一资源 ⇒ 只有第一次拿到 seq，第二次是原地更新
    expect(entry?.state.kind).toBe("play");
    if (entry?.state.kind === "play") {
      expect(entry.state.resource).toBe("a.ogg");
      expect(entry.state.seq).toBe(1);
    }
    dispose();
  });

  it("两个实例互不干扰：各记各的通道与音量", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "r.ogg",
        volume: 0.3,
      },
      {
        op: "audio_play",
        inst: "steps",
        channel: "se",
        resource: "s.ogg",
        volume: 0.7,
      },
      TAIL,
    ]);
    const rain = instanceOf(engine, "rain");
    const steps = instanceOf(engine, "steps");
    expect(rain?.channel).toBe("ambient");
    expect(steps?.channel).toBe("se");
    expect(rain?.state.kind === "play" ? rain.state.volume : null).toBeCloseTo(
      0.3,
      6,
    );
    expect(
      steps?.state.kind === "play" ? steps.state.volume : null,
    ).toBeCloseTo(0.7, 6);
    dispose();
  });

  it("实例 id 非法 fail-closed 且指明形态（不静默建一个怪名字的实例）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "audio_play", inst: "Rain", channel: "ambient", resource: "a.ogg" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_play-invalid-instance");
    expect(Object.keys(tableOf(engine))).toEqual([]);
    // 错误文案要把形态写出来，否则作者只能靠猜
    const detail = errors
      .map((e) => (e.payload.kind === "engine.error" ? e.payload.message : ""))
      .join("\n");
    expect(detail).toContain(AUDIO_INSTANCE_ID_PATTERN.source);
    dispose();
  });

  it("通道非法 fail-closed（通道决定偏好归口，不能猜）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "music", resource: "a.ogg" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_play-invalid-channel");
    expect(Object.keys(tableOf(engine))).toEqual([]);
    dispose();
  });

  it("资源为空 fail-closed", () => {
    const { errors, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_play-invalid-resource");
    dispose();
  });

  it("未知字段 fail-closed（字段表即白名单）", () => {
    const { errors, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "a.ogg",
        echo: true,
      },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_play-unknown-field");
    dispose();
  });

  it("超过实例上限就拒（不是写进存档之后才发现）", () => {
    const commands: object[] = [];
    for (let i = 0; i <= MAX_AUDIO_INSTANCES; i += 1) {
      commands.push({
        op: "audio_play",
        inst: `s${String(i).padStart(2, "0")}`,
        channel: "ambient",
        resource: "a.ogg",
      });
    }
    commands.push(TAIL);
    const { engine, errors, dispose } = makeEngine(commands);
    expect(errorCodes(errors)).toContain("audio_play-instance-limit");
    expect(Object.keys(tableOf(engine))).toHaveLength(MAX_AUDIO_INSTANCES);
    dispose();
  });
});

describe("音频实例 · audio_stop", () => {
  it("停一个：该实例转 stop 形态，别的实例照常", () => {
    const { engine, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_play", inst: "steps", channel: "se", resource: "s.ogg" },
      { op: "audio_stop", inst: "rain", fade: 250 },
      TAIL,
    ]);
    const rain = instanceOf(engine, "rain");
    const steps = instanceOf(engine, "steps");
    expect(rain?.state.kind).toBe("stop");
    if (rain?.state.kind === "stop") expect(rain.state.fadeMs).toBe(250);
    expect(steps?.state.kind).toBe("play");
    dispose();
  });

  it("缺 inst 就停全部，且每个实例各领一个序号", () => {
    const { engine, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_play", inst: "steps", channel: "se", resource: "s.ogg" },
      { op: "audio_stop" },
      TAIL,
    ]);
    const table = tableOf(engine);
    const rain = table["rain"];
    const steps = table["steps"];
    expect(rain?.state.kind).toBe("stop");
    expect(steps?.state.kind).toBe("stop");
    const seqs = [rain?.state.seq, steps?.state.seq];
    expect(seqs[0]).toBeTypeOf("number");
    expect(seqs[0]).not.toBe(seqs[1]);
    dispose();
  });

  it("没有实例可停时不算错（作者不必先判空）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "audio_stop" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toEqual([]);
    expect(Object.keys(tableOf(engine))).toEqual([]);
    dispose();
  });

  it("停不存在的实例 fail-closed，并把当前实例列出来", () => {
    const { errors, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_stop", inst: "snow" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_stop-unknown-instance");
    const detail = errors
      .map((e) => (e.payload.kind === "engine.error" ? e.payload.message : ""))
      .join("\n");
    expect(detail).toContain("rain");
    dispose();
  });
});

describe("音频实例 · audio_volume", () => {
  it("只改音量：不重播、不动序号（滑块拖动不该让音乐从头开始）", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "r.ogg",
        volume: 0.2,
      },
      { op: "audio_volume", inst: "rain", volume: 0.9 },
      TAIL,
    ]);
    const entry = instanceOf(engine, "rain");
    expect(entry?.state.kind).toBe("play");
    if (entry?.state.kind === "play") {
      expect(entry.state.volume).toBeCloseTo(0.9, 6);
      // 关键判据：序号没变 ⇒ 渲染层不会把它当成一次新的起播
      expect(entry.state.seq).toBe(1);
      expect(entry.state.resource).toBe("r.ogg");
    }
    dispose();
  });

  it("越界音量按边界钳制（与命令面 volume= 同口径）", () => {
    const { engine, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_volume", inst: "rain", volume: 7 },
      TAIL,
    ]);
    const entry = instanceOf(engine, "rain");
    expect(entry?.state.kind === "play" ? entry.state.volume : null).toBe(1);
    dispose();
  });

  it("缺 volume fail-closed", () => {
    const { errors, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_volume", inst: "rain" },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_volume-missing-volume");
    dispose();
  });

  it("给已停止的实例调音量 fail-closed（先起播再调）", () => {
    const { errors, dispose } = makeEngine([
      { op: "audio_play", inst: "rain", channel: "ambient", resource: "r.ogg" },
      { op: "audio_stop", inst: "rain" },
      { op: "audio_volume", inst: "rain", volume: 0.5 },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_volume-instance-stopped");
    dispose();
  });

  it("给不存在的实例调音量 fail-closed", () => {
    const { errors, dispose } = makeEngine([
      { op: "audio_volume", inst: "rain", volume: 0.5 },
      TAIL,
    ]);
    expect(errorCodes(errors)).toContain("audio_volume-unknown-instance");
    dispose();
  });
});

describe("音频实例 · 写时复制与随档", () => {
  it("改音量不会污染旧表引用：快照拿得到当时的值", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "r.ogg",
        volume: 0.2,
      },
      { op: "say", text: "第一步" },
      { op: "audio_volume", inst: "rain", volume: 0.8 },
      { op: "say", text: "第二步" },
    ]);
    // 回滚到第一个检查点：音量回到 0.2
    engine.rollbackTo(1);
    const entry = instanceOf(engine, "rain");
    expect(
      entry?.state.kind === "play" ? entry.state.volume : null,
    ).toBeCloseTo(0.2, 6);
    dispose();
  });

  it("实例表进存档并能原样读回", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "audio_play",
        inst: "rain",
        channel: "ambient",
        resource: "r.ogg",
        volume: 0.35,
      },
      TAIL,
    ]);
    const saved = engine.exportSave();
    expect(saved).not.toBeNull();
    const before = instanceOf(engine, "rain");
    dispose();

    const second = makeEngine([TAIL]);
    expect(second.engine.importSave(saved!)).toBe(true);
    const after = instanceOf(second.engine, "rain");
    expect(after).toEqual(before);
    second.dispose();
  });
});

describe("音频实例 · 文本形态双向投影", () => {
  const commands = [
    {
      op: "audio_play",
      inst: "rain",
      channel: "ambient",
      resource: "rain.ogg",
      volume: 0.3,
    },
    { op: "audio_volume", inst: "rain", volume: 0.6 },
    { op: "audio_stop", inst: "rain", fade: 200 },
    { op: "audio_stop" },
  ];

  it("JSON → 文本 → JSON 往返等价", () => {
    const text = projectText(makeStory(commands)).text;
    const again = parseTextStory(text);
    expect(again.columns[0]?.commands).toEqual(commands);
  });

  it("文本形态把实例 id 写成位置参数、可选项写成 key=value", () => {
    const text = projectText(makeStory(commands)).text;
    expect(text).toContain('audio_play rain ambient "rain.ogg" volume=0.3');
    expect(text).toContain("audio_volume rain volume=0.6");
    expect(text).toContain("audio_stop rain fade=200");
    // 停全部：不带位置参数
    expect(text).toMatch(/^\s*audio_stop\s*$/m);
  });

  it("文本写法认不出参数就 fail-closed（不静默丢掉作者的意图）", () => {
    const bad = projectText(makeStory([{ op: "stop_se" }])).text.replace(
      "stop_se",
      'audio_play rain ambient "r.ogg" echo=true',
    );
    expect(() => parseTextStory(bad)).toThrow(/audio_play 未知参数/);
  });
});
