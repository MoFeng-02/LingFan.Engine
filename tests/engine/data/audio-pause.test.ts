/**
 * 音频暂停态的数据层测试：
 * 文本投影往返（含 channel 省略形）/ 存档序列化往返 / 快照随行 / 回溯到暂停态。
 *
 * 断言的是「暂停这件事能不能被写出去、读回来、回到过去」——
 * 端口侧的可恢复暂停由 ui / adapters 的测试覆盖。
 */
import { describe, expect, it } from "vitest";
import type { AudioChannelState, SaveDataV1 } from "@lingfan-engine/core";
import {
  SYS,
  StoryEngine,
  TextFormatError,
  generateText,
  parseStory,
  parseTextStory,
} from "@lingfan-engine/core";

function engineOf(commands: object[]): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "audio-pause",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 5 },
  );
}

function channel(engine: StoryEngine, key: string): AudioChannelState | null {
  return (engine.get(key) ?? null) as AudioChannelState | null;
}

describe("文本投影：暂停 / 恢复语句的规范形", () => {
  it("带 channel 与省略 channel 两种写法往返保真", () => {
    const commands = [
      { op: "audio_pause", channel: "bgm" },
      { op: "audio_pause" },
      { op: "audio_resume", channel: "voice" },
      { op: "audio_resume" },
    ];
    const text = generateText(
      parseStory({
        formatVersion: 1,
        id: "p",
        columns: [{ id: "start", kind: "flow", commands }],
      }),
    );
    // 省略 channel 是「全部常驻通道」，投影时不能补出默认值
    expect(text).toContain("audio_pause bgm");
    expect(text).toContain("audio_resume voice");
    expect(
      text.split("\n").filter((line) => line.trim() === "audio_pause"),
    ).toHaveLength(1);
    expect(
      text.split("\n").filter((line) => line.trim() === "audio_resume"),
    ).toHaveLength(1);
    expect(parseTextStory(text, "p.story").columns[0]?.commands).toEqual(
      commands,
    );
  });

  it("非法 channel / 多余参数：解析期拒绝（不静默降级成全部通道）", () => {
    expect(() =>
      parseTextStory('label a:\n  audio_pause "bgm2"\n', "p.story"),
    ).toThrow(TextFormatError);
    expect(() =>
      parseTextStory("label a:\n  audio_pause bgm ambient\n", "p.story"),
    ).toThrow(TextFormatError);
  });
});

describe("存档序列化：暂停态与记账一起进出档", () => {
  it("exportSave → JSON → importSave：暂停态保持，恢复后回到原曲目", () => {
    const engine = engineOf([
      { op: "bgm", resource: "a.mp3", volume: 0.4 },
      { op: "audio_pause", channel: "bgm" },
      { op: "say", text: "暂停中" },
    ]);
    try {
      engine.start();
      const data = engine.exportSave();
      expect(data).not.toBeNull();
      const keys = new Map(data!.state);
      // pause 态本身不带资源，跨 JSON 只留 kind + seq
      expect(keys.get(SYS.audioBgm)).toMatchObject({ kind: "pause" });
      // 暂停前的 play 态靠记账键随档：否则读档后无从续播
      expect(keys.get(SYS.audioPaused)).toMatchObject({
        bgm: { kind: "play", resource: "a.mp3", volume: 0.4 },
      });

      const restored = engineOf([{ op: "say", text: "占位" }]);
      try {
        expect(
          restored.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
        ).toBe(true);
        expect(channel(restored, SYS.audioBgm)).toMatchObject({
          kind: "pause",
        });
      } finally {
        restored.dispose();
      }
    } finally {
      engine.dispose();
    }
  });
});

describe("快照随行与回溯", () => {
  it("暂停后的快照保留暂停态；回溯到暂停前的检查点恢复 play 态", () => {
    const engine = engineOf([
      { op: "bgm", resource: "a.mp3" },
      { op: "say", text: "一" },
      { op: "audio_pause", channel: "bgm" },
      { op: "say", text: "二" },
      { op: "say", text: "三" },
    ]);
    try {
      engine.start(); // say 一：检查点 0 捕获 play 态
      engine.advance(); // 执行 audio_pause，提交检查点 1；停在 say 二
      expect(channel(engine, SYS.audioBgm)).toMatchObject({ kind: "pause" });
      engine.advance(); // 停在 say 三，检查点 2 捕获 pause 态

      // 回溯到「暂停之后」的检查点：暂停态是快照的一部分，不是临时态
      engine.rollbackTo(2);
      expect(channel(engine, SYS.audioBgm)).toMatchObject({ kind: "pause" });

      // 回溯到「暂停之前」：回到 play 态，记账也随之作废
      engine.rollbackTo(0);
      expect(channel(engine, SYS.audioBgm)).toEqual({
        kind: "play",
        resource: "a.mp3",
        volume: 1,
        loop: true,
        fadeMs: 0,
      });
      expect(engine.get(SYS.audioPaused)).toBeUndefined();
    } finally {
      engine.dispose();
    }
  });
});
