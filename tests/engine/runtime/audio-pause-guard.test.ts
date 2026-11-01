/**
 * 播放态判据的形状守卫：`kind === "play"` 但缺 `resource` 的坏值不得被当成播放态。
 *
 * 暂停记账表与实例表都随快照 / 存档随行，读回来的值可能是被外部改坏的值。把一条没有
 * 资源的 play 态当成播放态，暂停会把它改写成 pause 态并记进 `SYS.audioPaused`，恢复时
 * 再写回一条播不出声的播放态——坏值因此被固化进存档。
 *
 * 通道与实例两族共用 `isPlayState` 这一份判据。实例路径另有 `isAudioInstanceTable`
 * 这一层表级校验同要求 `resource`，两层各自都能挡下「实例表里缺资源」的坏值，所以
 * 表内用例（实例侧）要两层同时放宽才会红；记账表读回路径只有 `isPlayState` 一层，
 * 恢复侧用例因此是单点承重的那一面。第三条正例证明暂停本身仍在工作，其余用例不是
 * 因为它整体失效才绿。
 */
import { describe, expect, it } from "vitest";
import type { AudioChannelState } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

class ProbeEngine extends StoryEngine {
  /** 开一条只写口：模拟「外部把某个系统键改成不合契约形状的值」 */
  writeSystem(key: string, value: unknown): void {
    this.setSystem(key, value);
  }
}

function makeEngine(): ProbeEngine {
  const engine = new ProbeEngine(
    parseStory({
      formatVersion: 1,
      id: "audio-pause-guard",
      columns: [
        { id: "start", kind: "flow", commands: [{ op: "say", text: "停" }] },
      ],
    }),
    { rngSeed: 5 },
  );
  engine.start();
  return engine;
}

function channelOf(engine: StoryEngine, key: string): unknown {
  return engine.get(key) ?? null;
}

function pausedOf(engine: StoryEngine): Record<string, AudioChannelState> {
  return (engine.get(SYS.audioPaused) ?? {}) as Record<
    string,
    AudioChannelState
  >;
}

function instanceStateOf(engine: StoryEngine, instanceId: string): unknown {
  const table = channelOf(engine, SYS.audioInstances) as Record<
    string,
    { state?: unknown }
  >;
  return table[instanceId]?.state;
}

describe("播放态判据的形状守卫", () => {
  it("通道侧：没有 resource 的 play 态不被当成 play 态暂停", () => {
    const engine = makeEngine();
    try {
      engine.writeSystem(SYS.audioBgm, { kind: "play" });
      engine.pause();

      expect(
        channelOf(engine, SYS.audioBgm),
        "没有 resource 的 play 态被当成 play 态暂停了（守卫失效）",
      ).toEqual({ kind: "play" });
      expect(
        pausedOf(engine).bgm,
        "没有 resource 的 play 态被记进了暂停记账表（守卫失效）",
      ).toBeUndefined();
    } finally {
      engine.dispose();
    }
  });

  it("实例侧：没有 resource 的 play 态不被当成 play 态暂停", () => {
    // 这里刻意只缺 `resource`、其余字段全合契约，让「缺 resource」成为唯一的可疑条件。
    // 实例表进 `pauseAudioInstances` 之前要过 `isAudioInstanceTable`，该判据同样要求
    // `resource`，缺资源的整表在此就被判坏、按空表处理——两层判据都在时这条用例绿，
    // 只有两层同时放宽才会红。
    const engine = makeEngine();
    try {
      engine.writeSystem(SYS.audioInstances, {
        rain: {
          channel: "ambient",
          state: { kind: "play", volume: 1, loop: true, fadeMs: 0 },
        },
      });
      engine.pause();

      expect(
        instanceStateOf(engine, "rain"),
        "没有 resource 的 play 态被当成 play 态暂停了（守卫失效）",
      ).toMatchObject({ kind: "play" });
      expect(
        pausedOf(engine)["inst:rain"],
        "没有 resource 的 play 态被记进了暂停记账表（守卫失效）",
      ).toBeUndefined();
    } finally {
      engine.dispose();
    }
  });

  it("恢复侧：记账表里没有 resource 的 play 态不被写回实例", () => {
    // 记账表经 `readPausedPlayStates` 直接读 `SYS.audioPaused`，中间没有表级校验，
    // `isPlayState` 是这条路上唯一的闸门：漏过它，恢复就会把一条没有资源的 play 态
    // 写进实例表（`setSystem` 不做运行期形状校验，坏值直接落进 SSOT）。
    const engine = makeEngine();
    try {
      engine.writeSystem(SYS.audioInstances, {
        rain: { channel: "ambient", state: { kind: "pause", seq: 1 } },
      });
      engine.writeSystem(SYS.audioPaused, { "inst:rain": { kind: "play" } });

      engine.pause();
      engine.resume();

      expect(
        instanceStateOf(engine, "rain"),
        "记账表里没有 resource 的 play 态被写回了实例（守卫失效）",
      ).toMatchObject({ kind: "pause" });
    } finally {
      engine.dispose();
    }
  });

  it("正例：合形态的 play 态照常被暂停并记账", () => {
    const engine = makeEngine();
    try {
      engine.writeSystem(SYS.audioBgm, {
        kind: "play",
        resource: "bgm/x",
        volume: 1,
        loop: true,
        fadeMs: 0,
      });
      engine.pause();

      const state = channelOf(engine, SYS.audioBgm) as AudioChannelState;
      expect(state).toMatchObject({ kind: "pause" });
      expect(state.seq).toBeTypeOf("number");
      expect(pausedOf(engine).bgm).toMatchObject({
        kind: "play",
        resource: "bgm/x",
      });
    } finally {
      engine.dispose();
    }
  });
});
