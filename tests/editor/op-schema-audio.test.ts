/**
 * 音频实例三 op 的编辑器侧契约：schema 字段面、表单字段表、词汇层 builder、DSL 往返。
 *
 * 五个同步点在这一族上最容易被漏掉的是**采样表**与**canonical 语料**——漏了不会有
 * 编译错误，只会让「词汇层双射」和「引擎 ↔ schema 双接受」在别处红，还看不出是谁
 * 缺了。所以本文件逐个点正面断言，而不是等互锁测试从另一头报错。
 *
 * 注意 schema 只校验**负载**：`op` 是路由键，不在 payload 里（`OP_SCHEMAS[op]` 本身
 * 就是那个键承载的东西）。往 payload 塞 `op` 会被 strictObject 判成未知字段。
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan-engine/core";
import { parseStory, projectText, parseTextStory } from "@lingfan-engine/core";
import { OP_SCHEMAS } from "@lingfan-engine/editor";
import * as script from "@lingfan-engine/editor";
import { FIELD_META } from "../../packages/editor/src/schema/catalog.ts";

const INSTANCE_OPS = ["audio_play", "audio_stop", "audio_volume"] as const;

/** 把带 op 的命令拆成「op + 负载」，用于喂 payload schema */
function payloadOf(cmd: StoryCommand): {
  op: string;
  payload: Record<string, unknown>;
} {
  const { op, ...payload } = cmd as unknown as Record<string, unknown> & {
    op: string;
  };
  return { op, payload };
}

function singleColumn(commands: StoryCommand[]) {
  return parseStory({
    formatVersion: 1,
    id: "audio-instance",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

describe("音频实例 · schema 字段面", () => {
  it("三个 op 都进了 OP_SCHEMAS（漏一个就配不出命令）", () => {
    for (const op of INSTANCE_OPS) {
      expect(Object.keys(OP_SCHEMAS), `缺 ${op}`).toContain(op);
    }
  });

  it("audio_play 必填 inst / channel / resource，可选 volume / loop / fade / restart", () => {
    const schema = OP_SCHEMAS["audio_play"]!;
    expect(
      schema.safeParse({ inst: "rain", channel: "ambient", resource: "r.ogg" })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        inst: "rain",
        channel: "ambient",
        resource: "r.ogg",
        volume: 0.3,
        loop: false,
        fade: 200,
        restart: true,
      }).success,
    ).toBe(true);
    // 缺任一项必填 ⇒ 拒
    expect(schema.safeParse({ inst: "rain", channel: "ambient" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ channel: "ambient", resource: "r.ogg" }).success,
    ).toBe(false);
    expect(schema.safeParse({ inst: "rain", resource: "r.ogg" }).success).toBe(
      false,
    );
  });

  it("channel 只收四个通道值（拼错不放过）", () => {
    const schema = OP_SCHEMAS["audio_play"]!;
    expect(
      schema.safeParse({ inst: "rain", channel: "music", resource: "r.ogg" })
        .success,
    ).toBe(false);
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      expect(
        schema.safeParse({ inst: "rain", channel, resource: "r.ogg" }).success,
        channel,
      ).toBe(true);
    }
  });

  it("实例 id 形态与引擎同一条（大写 / 数字开头 / 超长 / 空串都拒）", () => {
    const schema = OP_SCHEMAS["audio_play"]!;
    for (const bad of ["Rain", "2rain", "a".repeat(33), ""]) {
      expect(
        schema.safeParse({ inst: bad, channel: "bgm", resource: "r.ogg" })
          .success,
        bad,
      ).toBe(false);
    }
    // 边界：恰 32 位合法
    expect(
      schema.safeParse({
        inst: "a".repeat(32),
        channel: "bgm",
        resource: "r.ogg",
      }).success,
    ).toBe(true);
  });

  it("audio_stop 的 inst 可省（省略 = 停全部）", () => {
    const schema = OP_SCHEMAS["audio_stop"]!;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ inst: "rain", fade: 100 }).success).toBe(true);
  });

  it("audio_volume 两个字段都必填", () => {
    const schema = OP_SCHEMAS["audio_volume"]!;
    expect(schema.safeParse({ inst: "rain", volume: 0.5 }).success).toBe(true);
    expect(schema.safeParse({ inst: "rain" }).success).toBe(false);
    expect(schema.safeParse({ volume: 0.5 }).success).toBe(false);
  });

  it("未知字段一律拒（strictObject 的用处就在这里）", () => {
    const okPayloads: Record<(typeof INSTANCE_OPS)[number], object> = {
      audio_play: { inst: "rain", channel: "bgm", resource: "r.ogg" },
      audio_stop: {},
      audio_volume: { inst: "rain", volume: 0.5 },
    };
    for (const op of INSTANCE_OPS) {
      const schema = OP_SCHEMAS[op]!;
      expect(schema.safeParse(okPayloads[op]).success, op).toBe(true);
      expect(
        schema.safeParse({ ...okPayloads[op], echo: true }).success,
        op,
      ).toBe(false);
    }
  });
});

describe("音频实例 · 编辑器表单字段表", () => {
  it("每个字段都有中文标签（表单里不会出现裸键名）", () => {
    const fields: ReadonlyArray<readonly [string, string]> = [
      ["audio_play.inst", "实例 id"],
      ["audio_play.channel", "归属通道"],
      ["audio_play.resource", "资源"],
      ["audio_play.volume", "音量（0–1）"],
      ["audio_play.loop", "循环"],
      ["audio_play.fade", "淡入（毫秒）"],
      ["audio_play.restart", "重新起播"],
      ["audio_stop.inst", "实例 id（留空 = 全部）"],
      ["audio_stop.fade", "淡出（毫秒）"],
      ["audio_volume.inst", "实例 id"],
      ["audio_volume.volume", "音量（0–1）"],
    ];
    for (const [key, label] of fields) {
      expect(FIELD_META[key]?.label, key).toBe(label);
    }
  });

  it("字段种类与 schema 一致（音量是数字、循环是布尔、id 是文本）", () => {
    expect(FIELD_META["audio_play.volume"]?.kind).toBe("number");
    expect(FIELD_META["audio_play.loop"]?.kind).toBe("boolean");
    expect(FIELD_META["audio_play.inst"]?.kind).toBe("text");
  });
});

describe("音频实例 · 词汇层 builder", () => {
  it("三个 builder 都从包根取得到（作者只 import 一个名字）", () => {
    expect(typeof script.audioPlay).toBe("function");
    expect(typeof script.audioStop).toBe("function");
    expect(typeof script.audioVolume).toBe("function");
  });

  it("builder 产出的命令过得了 schema（形状零漂移）", () => {
    const cases: StoryCommand[] = [
      script.audioPlay("rain", "ambient", "rain.ogg", {
        volume: 0.3,
        loop: true,
      }),
      script.audioStop("rain", { fade: 200 }),
      script.audioStop(),
      script.audioVolume("rain", 0.6),
    ];
    for (const cmd of cases) {
      const { op, payload } = payloadOf(cmd);
      expect(OP_SCHEMAS[op]!.safeParse(payload).success, op).toBe(true);
    }
  });

  it("audioStop 省略实例时命令里不出现 inst 键（不留 undefined 字段）", () => {
    const cmd = script.audioStop();
    expect(Object.hasOwn(cmd, "inst")).toBe(false);
    expect(cmd).toEqual({ op: "audio_stop" });
  });
});

describe("音频实例 · DSL 双向投影", () => {
  const commands: StoryCommand[] = [
    {
      op: "audio_play",
      inst: "rain",
      channel: "ambient",
      resource: "rain.ogg",
      volume: 0.3,
    },
    {
      op: "audio_play",
      inst: "steps",
      channel: "se",
      resource: "steps.ogg",
      loop: false,
      fade: 120,
      restart: true,
    },
    { op: "audio_volume", inst: "rain", volume: 0.6 },
    { op: "audio_stop", inst: "rain", fade: 200 },
    { op: "audio_stop" },
  ];

  it("JSON → 文本 → JSON 往返逐字段等价", () => {
    const text = projectText(singleColumn(commands)).text;
    const again = parseTextStory(text);
    expect(again.columns[0]?.commands).toEqual(commands);
  });

  it("投影没有产生 issue（三 op 都有文本形态，不是 JSON 专属）", () => {
    expect(projectText(singleColumn(commands)).issues).toEqual([]);
  });

  it("写出的是位置参数 + key=value，作者手写也能这么写", () => {
    const hand = [
      "label start:",
      '  audio_play rain ambient "rain.ogg" volume=0.3',
      "  audio_volume rain volume=0.6",
      "  audio_stop rain fade=200",
      "  audio_stop",
      "",
    ].join("\n");
    const story = parseTextStory(hand);
    expect(story.columns[0]?.commands).toEqual([
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
    ]);
  });
});
