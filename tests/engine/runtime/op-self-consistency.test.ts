/**
 * op 自洽：parse 面补齐、stateVersion 整数口径、宽松参数收紧、五源相等。
 *
 * 四件事各自独立成判据：
 * - 媒体族 / nvl / interaction / mount 的必填与类型在**装载期**就被判掉，
 *   合法输入原样通过且文本投影往返不变（不是把合法行为也改掉了）。
 * - 扩展 stateVersion 必须是正整数：NaN / 小数 / 非正数都在装配期拒绝。
 * - character 未知字段、nvl 未知 mode、video_skipable 非布尔：非法值拒绝，
 *   合法值的结果与收紧前完全一致。
 * - 内建 op 名清单 ≡ 分发 case 集 ≡ 词汇表 ≡ 编辑期 schema 键集，
 *   任何一处漂移都会在这里变红（docs reference 与规约是同一批人工同步的散文源）。
 */
import { describe, expect, it } from "vitest";
import type { OpExtension, OutboundEvent } from "@lingfan-engine/core";
import {
  BUILTIN_OP_NAMES,
  generateText,
  parseStory,
  parseTextStory,
  StoryEngine,
  SYS,
} from "@lingfan-engine/core";
import dispatchSource from "../../../packages/core/src/runtime/dispatch.ts?raw";
import { OP_SCHEMAS } from "../../../packages/editor/src/schema/opSchemas";
import { VOCABULARY_OPS } from "../../../packages/editor/src/script";

/** 24 条合法命令：音频 14（含 audio_seek）+ 视频 7 + nvl / interaction / mount。 */
type MediaCommand = { op: string } & Record<string, unknown>;
const LEGAL_MEDIA_COMMANDS: MediaCommand[] = [
  { op: "bgm", resource: "a.mp3" },
  { op: "stop_bgm" },
  { op: "se", resource: "b.mp3" },
  { op: "ambient", resource: "c.mp3" },
  { op: "stop_ambient" },
  { op: "voice", resource: "d.mp3" },
  { op: "stop_voice" },
  { op: "stop_se" },
  { op: "audio_play", inst: "rain", channel: "ambient", resource: "e.mp3" },
  { op: "audio_stop", inst: "rain" },
  { op: "audio_volume", inst: "rain", volume: 0.5 },
  { op: "audio_pause", channel: "bgm" },
  { op: "audio_resume", channel: "bgm" },
  { op: "audio_seek", inst: "rain", seconds: 12 },
  { op: "video", resource: "v.mp4" },
  { op: "cutscene", resource: "c.mp4" },
  { op: "seek_video", seconds: 5 },
  { op: "pause_video" },
  { op: "resume_video" },
  { op: "stop_video" },
  { op: "video_skipable", value: true },
  { op: "nvl", mode: "enter" },
  { op: "interaction", system: "walk" },
  { op: "mount", name: "hud", visible: true },
];

function storyOf(commands: MediaCommand[]) {
  return parseStory({
    formatVersion: 1,
    id: "self-consistency",
    columns: [{ id: "start", kind: "flow", commands }],
  });
}

describe("parse 面补齐：媒体族 / nvl / interaction / mount", () => {
  it("parse-23ops-roundtrip：合法输入装载期通过，文本投影往返不变", () => {
    const story = storyOf(LEGAL_MEDIA_COMMANDS);
    expect(story.columns[0]!.commands).toHaveLength(
      LEGAL_MEDIA_COMMANDS.length,
    );
    // interaction 是 JSON-only（无文本投影，设计如此）；其余 23 条走文本往返。
    // nvl 用非缺省 mode（缺省 enter 投影会省略，往返不保真）；逐条比命令面。
    const roundtrip = LEGAL_MEDIA_COMMANDS.filter(
      (c) => c.op !== "interaction",
    ).map((c) => (c.op === "nvl" ? { op: "nvl", mode: "clear" } : c));
    const source = storyOf(roundtrip);
    const reparsed = parseTextStory(generateText(source));
    expect(reparsed.columns[0]!.commands).toEqual(source.columns[0]!.commands);
  });

  it("parse-23ops-roundtrip：必填缺失 / 类型非法在装载期整文件拒绝", () => {
    const badCases: Array<{ cmd: MediaCommand; issue: RegExp }> = [
      { cmd: { op: "bgm" }, issue: /resource 必须为非空字符串/ },
      {
        cmd: { op: "audio_play", inst: "rain", channel: "ambient" },
        issue: /resource 必须为非空字符串/,
      },
      {
        cmd: { op: "audio_volume", inst: "rain" },
        issue: /volume 必须为有限数字/,
      },
      {
        cmd: { op: "audio_seek", inst: "rain" },
        issue: /seconds 必须为非负有限数/,
      },
      {
        cmd: { op: "audio_seek", inst: "rain", seconds: -1 },
        issue: /seconds 必须为非负有限数/,
      },
      { cmd: { op: "seek_video" }, issue: /seconds 必须为非负有限数/ },
      {
        cmd: { op: "video_skipable", value: "yes" },
        issue: /value 必须为布尔/,
      },
      { cmd: { op: "mount", name: "hud" }, issue: /visible 必须为布尔/ },
      { cmd: { op: "interaction" }, issue: /system 必须为非空字符串/ },
      { cmd: { op: "nvl", mode: "bogus" }, issue: /mode 必须为/ },
    ];
    for (const { cmd, issue } of badCases) {
      expect(() => storyOf([cmd]), JSON.stringify(cmd)).toThrow(issue);
    }
  });
});

describe("扩展 stateVersion：正整数口径", () => {
  function ext(stateVersion: number): OpExtension {
    return {
      id: "demo",
      stateVersion,
      ops: [{ op: "demo_noop", exec: () => ({ ok: true }) }],
    };
  }

  it("stateversion-integer-reject：NaN / 小数 / 非正数装配期拒绝", () => {
    for (const bad of [Number.NaN, 1.5, 0, -1, 0.5]) {
      expect(
        () =>
          new StoryEngine(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { formatVersion: 1, id: "t", entry: "a", columns: [] } as any,
            { extensions: [ext(bad)] },
          ),
        `stateVersion=${bad}`,
      ).toThrow(/stateVersion/);
    }
  });

  it("stateversion-integer-reject：正整数原样通过（合法行为不变）", () => {
    for (const good of [1, 2, 7]) {
      expect(
        () =>
          new StoryEngine(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { formatVersion: 1, id: "t", entry: "a", columns: [] } as any,
            { extensions: [ext(good)] },
          ),
        `stateVersion=${good}`,
      ).not.toThrow();
    }
  });
});

describe("宽松参数收紧：非法拒绝，合法结果不变", () => {
  function run(commands: MediaCommand[]): {
    engine: StoryEngine;
    errors: OutboundEvent[];
  } {
    const errors: OutboundEvent[] = [];
    const engine = new StoryEngine(storyOf(commands), { rngSeed: 3 });
    engine.onEvent((e) => errors.push(e));
    engine.start();
    return { engine, errors };
  }

  it("strict-params-fail-closed：character 未知字段运行期拒绝且停驻", () => {
    const { engine, errors } = run([
      { op: "character", key: "a", bogus: 1 },
      { op: "say", text: "不应到达" },
    ]);
    const codes = errors
      .filter((e) => e.payload.kind === "engine.error")
      .map((e) => (e.payload as { code: string }).code);
    expect(codes).toContain("character-unknown-field");
    expect(engine.get(SYS.waiting)).toBeUndefined();
    engine.dispose();
  });

  it("strict-params-fail-closed：character 可选字段非法类型装载期拒绝", () => {
    expect(() => storyOf([{ op: "character", key: "a", font: 123 }])).toThrow(
      /font 必须为字符串/,
    );
  });

  it("strict-params-fail-closed：合法 character 原样注册（收紧不改合法行为）", () => {
    const { engine, errors } = run([
      { op: "character", key: "a", name: "阿岚", color: "#fff" },
      { op: "say", text: "到达" },
    ]);
    const codes = errors
      .filter((e) => e.payload.kind === "engine.error")
      .map((e) => (e.payload as { code: string }).code);
    expect(codes).toHaveLength(0);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    engine.dispose();
  });

  it("strict-params-fail-closed：video_skipable 合法布尔结果不变", () => {
    const { engine, errors } = run([
      { op: "video_skipable", value: false },
      { op: "say", text: "到达" },
    ]);
    expect(engine.get(SYS.videoSkipable)).toBe(false);
    const codes = errors
      .filter((e) => e.payload.kind === "engine.error")
      .map((e) => (e.payload as { code: string }).code);
    expect(codes).toHaveLength(0);
    engine.dispose();
  });
});

describe("五源相等：内建 op 面零漂移", () => {
  it("five-sources-equal：名清单 ≡ 分发 case ≡ 词汇表 ≡ schema 键集", () => {
    const start = dispatchSource.indexOf("switch (cmd.op) {");
    const end = dispatchSource.indexOf("default:", start);
    const dispatchCases = new Set(
      [...dispatchSource.slice(start, end).matchAll(/case "([^"]+)":/g)].map(
        (m) => m[1]!,
      ),
    );
    const vocabulary = new Set(VOCABULARY_OPS);
    const schemaKeys = new Set(Object.keys(OP_SCHEMAS));
    expect(dispatchCases).toEqual(BUILTIN_OP_NAMES);
    expect(vocabulary).toEqual(BUILTIN_OP_NAMES);
    expect(schemaKeys).toEqual(BUILTIN_OP_NAMES);
    expect(BUILTIN_OP_NAMES.has("audio_seek")).toBe(true);
  });
});
