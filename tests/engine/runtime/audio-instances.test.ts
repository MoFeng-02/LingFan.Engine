/**
 * **音频实例表的契约面**（SSOT 键 / 形态 / id 与上限 / 随档随快照通行）。
 *
 * 实例是四通道之外的另一层：作者可以起名字、按名字调音量、各放各的。
 * 这一组守五件事，任何一条塌了都会让后面三块（端口 / 三级解析 / 命令面）失去地基：
 *
 * 1. 键是普通 SSOT 值：写入可读回，且已登记双向档位（否则参数方向判据会红）；
 * 2. 判据不抛：非法 id、超上限、畸形形态一律返回 false，由调用方 fail-closed；
 * 3. 上限是**读入判据**的一部分：存档里被改成 100 个实例，装载阶段就挡下来；
 * 4. 随档：`exportSave` → `importSave` 往返后实例表原样；
 * 5. 随快照：回溯后每个实例的音量回到当时值。
 *
 * 为什么要专门测「判据不抛」：这张表既来自作者也可能来自手改的存档，
 * 抛错会让读档路径崩在恢复流程中间，那比拒绝整档难查得多。
 */
import { describe, expect, it } from "vitest";
import {
  AUDIO_INSTANCE_ID_PATTERN,
  MAX_AUDIO_INSTANCES,
  SYS,
  StoryEngine,
  directionOf,
  findJsonValueError,
  isAudioInstanceId,
  isAudioInstanceTable,
  parseStory,
  type AudioInstanceState,
  type AudioInstanceTable,
  type SaveDataV1,
} from "@lingfan-engine/core";

// ---------- 夹具 ----------

/**
 * 探针引擎：把 `setSystem` 暴露给测试。
 *
 * 为什么需要：实例命令面（`audio_play inst=…`）属于后续任务，本任务只落契约；
 * 而「随档 / 随快照 / 读回」必须用真引擎验证才有意义。`setSystem` 是引擎
 * 写 SYS 键的正规通道，测试借子类开一个只进不出的口子，不绕过任何闸门。
 */
class ProbeEngine extends StoryEngine {
  writeSystem(key: string, value: unknown): void {
    this.setSystem(key, value);
  }
}

/** 三列三句：给快照留出两个可回溯点 */
function makeEngine(): ProbeEngine {
  return new ProbeEngine(
    parseStory({
      formatVersion: 1,
      id: "audio-instances",
      entry: "start",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "一" },
            { op: "say", text: "二" },
            { op: "say", text: "三" },
          ],
        },
      ],
    }),
    { rngSeed: 11 },
  );
}

function instance(
  channel: AudioInstanceState["channel"],
  volume: number,
): AudioInstanceState {
  return {
    channel,
    state: { kind: "play", resource: "a.mp3", volume, loop: true, fadeMs: 0 },
  };
}

const TABLE: AudioInstanceTable = {
  rain: instance("ambient", 0.5),
  alarm: instance("se", 1),
};

// ---------- ① 键与档位 ----------

describe("音频实例表 · SSOT 键", () => {
  it("写入后可原值读回", () => {
    const engine = makeEngine();
    engine.start();
    engine.writeSystem(SYS.audioInstances, TABLE);
    expect(engine.get(SYS.audioInstances)).toEqual(TABLE);
  });

  it("已登记「双向」档位", () => {
    expect(directionOf(SYS.audioInstances)).toBe("two-way");
  });

  it("值是 JSON 安全（存档深校验能过）", () => {
    expect(findJsonValueError(TABLE, SYS.audioInstances)).toBeNull();
  });
});

// ---------- ② id 与形态判据 ----------

describe("音频实例表 · 判据", () => {
  it("合法 id 与非法 id 分得清且不抛", () => {
    for (const good of ["rain", "a", "bgm_2", "x-y", "a".repeat(32)]) {
      expect(isAudioInstanceId(good), good).toBe(true);
    }
    for (const bad of [
      "",
      "Rain",
      "2rain",
      "a b",
      "a".repeat(33),
      null,
      3,
      {},
    ]) {
      expect(isAudioInstanceId(bad), String(bad)).toBe(false);
    }
  });

  it("id 形态与短 id 同源（不是另一条正则）", () => {
    expect(AUDIO_INSTANCE_ID_PATTERN.source).toBe(
      /^[a-z][a-z0-9_-]{0,31}$/.source,
    );
  });

  it("畸形表返回 false 而不是抛错", () => {
    const bad: unknown[] = [
      null,
      [],
      "x",
      { rain: {} },
      { rain: { channel: "bgm" } },
      { rain: { channel: "harp", state: instance("bgm", 1).state } },
      { rain: { channel: "bgm", state: { kind: "play" } } },
      { Rain: instance("bgm", 1) },
      { "": instance("bgm", 1) },
    ];
    for (const value of bad) {
      expect(isAudioInstanceTable(value), JSON.stringify(value)).toBe(false);
    }
    expect(isAudioInstanceTable({})).toBe(true);
  });
});

// ---------- ③ 上限 ----------

describe("音频实例表 · 上限", () => {
  it("常量的值就是契约里写的 32", () => {
    // 写死期望值而非跟着常量走：跟着常量走的断言在常量被改小之后仍然全绿，
    // 那种「自适应测试」等于没测。
    expect(MAX_AUDIO_INSTANCES).toBe(32);
  });

  it(`恰好 ${MAX_AUDIO_INSTANCES} 个实例合规，再多一个即判不合形态`, () => {
    const at: Record<string, AudioInstanceState> = {};
    for (let i = 0; i < MAX_AUDIO_INSTANCES; i += 1) {
      at[`s${i}`] = instance("bgm", 1);
    }
    expect(Object.keys(at)).toHaveLength(32);
    expect(isAudioInstanceTable(at)).toBe(true);
    at[`s${MAX_AUDIO_INSTANCES}`] = instance("bgm", 1);
    expect(isAudioInstanceTable(at)).toBe(false);
  });
});

// ---------- ④ 随档 ----------

describe("音频实例表 · 随档", () => {
  it("exportSave → importSave 往返后原样", () => {
    const source = makeEngine();
    source.start();
    source.writeSystem(SYS.audioInstances, TABLE);
    const data = source.exportSave();
    expect(data).not.toBeNull();

    const target = makeEngine();
    expect(target.importSave(data as SaveDataV1)).toBe(true);
    expect(target.get(SYS.audioInstances)).toEqual(TABLE);
  });
});

// ---------- ⑤ 随快照 ----------

describe("音频实例表 · 随快照", () => {
  it("回溯后每个实例的音量回到当时值", () => {
    const engine = makeEngine();
    engine.start();
    engine.writeSystem(SYS.audioInstances, {
      rain: instance("ambient", 0.5),
    });
    engine.advance(); // 提交 cp0；cp1 的快照拿着 0.5
    engine.writeSystem(SYS.audioInstances, {
      rain: instance("ambient", 0.9),
    });
    engine.advance(); // 提交 cp1（0.5）；当前画面拿着 0.9

    const at = engine.get(SYS.audioInstances) as AudioInstanceTable;
    expect(at.rain?.state.kind === "play" && at.rain.state.volume).toBe(0.9);

    engine.rollbackTo(1);
    const back = engine.get(SYS.audioInstances) as AudioInstanceTable;
    expect(back.rain?.state.kind === "play" && back.rain.state.volume).toBe(
      0.5,
    );
  });
});

// ---------- ⑥ 写时复制 ----------

describe("音频实例表 · 写时复制", () => {
  it("换表不污染此前读到的引用", () => {
    const engine = makeEngine();
    engine.start();
    engine.writeSystem(SYS.audioInstances, TABLE);
    const before = engine.get(SYS.audioInstances) as AudioInstanceTable;

    engine.writeSystem(SYS.audioInstances, {
      ...TABLE,
      rain: instance("ambient", 0.2),
    });

    // 旧引用仍是旧表：改写走的是整表替换，没人原地改过它
    expect(before).toEqual(TABLE);
    expect(before.rain?.state.kind === "play" && before.rain.state.volume).toBe(
      0.5,
    );
    const after = engine.get(SYS.audioInstances) as AudioInstanceTable;
    expect(after.rain?.state.kind === "play" && after.rain.state.volume).toBe(
      0.2,
    );
    expect(after).not.toBe(before);
  });
});
