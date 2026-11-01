/**
 * 音频规划器 · 可恢复暂停：状态差量 → 端口动作的 pause/resume 三条规则。
 * 只测纯规划器（无端口、无引擎），se 的一次性触发语义另由 audio.test.ts 覆盖。
 */
import { describe, expect, it } from "vitest";
import type { AudioChannelState } from "@lingfan-engine/core";
import {
  EMPTY_AUDIO_VIEW,
  planAudioActions,
  type AudioView,
} from "@lingfan-engine/ui";

function play(resource: string, volume = 1, loop = true): AudioChannelState {
  return { kind: "play", resource, volume, loop, fadeMs: 0 };
}

function pause(seq = 1): AudioChannelState {
  return { kind: "pause", seq };
}

function view(partial: Partial<AudioView>): AudioView {
  return { ...EMPTY_AUDIO_VIEW, ...partial };
}

describe("planAudioActions · 暂停与恢复", () => {
  it("play → pause：出 pause 动作，不重播也不停止", () => {
    const actions = planAudioActions(
      view({ bgm: play("a.mp3") }),
      view({ bgm: pause() }),
    );
    expect(actions).toEqual([{ type: "pause", channel: "bgm" }]);
  });

  it("pause → play（同资源）：出 resume，不从起点重播", () => {
    const actions = planAudioActions(
      view({ bgm: pause() }),
      view({ bgm: play("a.mp3") }),
    );
    // 只有一条 resume：出现 play 就等于从头播，暂停就白做了
    expect(actions).toEqual([{ type: "resume", channel: "bgm" }]);
    expect(actions.some((a) => a.type === "play")).toBe(false);
  });

  it("pause → stop / null：出 stop（暂停中的实例必须先被停掉）", () => {
    const toStop = planAudioActions(
      view({ bgm: pause() }),
      view({ bgm: { kind: "stop", fadeMs: 400 } }),
    );
    expect(toStop).toEqual([{ type: "stop", channel: "bgm", fadeMs: 400 }]);

    const toNull = planAudioActions(view({ ambient: pause() }), view({}));
    expect(toNull).toEqual([{ type: "stop", channel: "ambient", fadeMs: 0 }]);
  });

  it("暂停态重复出现 / 从未播放即暂停：无动作（幂等，不建实例）", () => {
    expect(
      planAudioActions(view({ voice: pause(1) }), view({ voice: pause(2) })),
    ).toEqual([]);
    expect(planAudioActions(view({}), view({ voice: pause() }))).toEqual([]);
  });

  it("se 通道不参与暂停：pause 形态的音效不产生 pause/resume 动作", () => {
    const actions = planAudioActions(
      view({
        se: {
          kind: "play",
          resource: "hit.mp3",
          volume: 1,
          loop: false,
          fadeMs: 0,
          seq: 1,
        },
      }),
      view({ se: pause(2) }),
    );
    expect(actions.some((a) => a.type === "pause" || a.type === "resume")).toBe(
      false,
    );
    expect(actions).toEqual([]);
  });
});
