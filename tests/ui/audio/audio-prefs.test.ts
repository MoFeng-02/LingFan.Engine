/**
 * 08 §八.2 音频 × 玩家偏好：readAudioView 有效音量合成 + 渲染器偏好变化即时重规划。
 * 老引擎 GetEffectiveVolume 语义：合成末端 = op 音量 × 通道偏好，静音归零（不 stop）。
 * 偏好走渲染视图（而非改引擎状态）——差量规划器自动感知偏好变化，通道不重播。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannel,
  AudioPlayOptions,
  AudioPort,
  ResourcePort,
} from "@lingfan/engine";
import { PlayerPreferences, StoryEngine, parseStory } from "@lingfan/engine";
import { createAudioRenderer, readAudioView } from "@lingfan/ui";

/** bgm 常驻播放的引擎（bgm op volume 可调） */
function engineWithBgm(volume = 0.8): StoryEngine {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        {
          id: "a",
          kind: "flow",
          commands: [{ op: "bgm", resource: "bgm.mp3", volume, loop: true }],
        },
      ],
    }),
  );
  engine.start();
  return engine;
}

interface Call {
  kind: "play" | "stop";
  channel: AudioChannel;
  url?: string;
  options?: AudioPlayOptions;
}

function makePort(): { port: AudioPort; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    port: {
      play: (channel, url, options) =>
        calls.push({ kind: "play", channel, url, options }),
      stop: (channel) => calls.push({ kind: "stop", channel }),
      position: () => 0,
      dispose: () => undefined,
    },
  };
}

const resources: ResourcePort = {
  resolve: (id) => Promise.resolve(`/${id}`),
  release: () => undefined,
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** AudioChannelState 联合窄化：play 分支的合成音量（stop/null → undefined） */
function bgmVolume(view: ReturnType<typeof readAudioView>): number | undefined {
  const state = view.bgm;
  return state?.kind === "play" ? state.volume : undefined;
}

describe("readAudioView 合成（锚点: effective-volume-synthesis）", () => {
  it("有效音量 = op 音量 × 通道偏好（bgm 默认偏好 0.8）", () => {
    const engine = engineWithBgm(0.8);
    const prefs = new PlayerPreferences();
    // 默认偏好下合成：0.8 × 0.8 = 0.64
    expect(bgmVolume(readAudioView(engine, prefs))).toBeCloseTo(0.64);
    // 缺省不合成（原样，不复制对象）
    expect(bgmVolume(readAudioView(engine))).toBe(0.8);
  });

  it("偏好改写即时反映（0.8 × 0.5 = 0.4）", () => {
    const engine = engineWithBgm(0.8);
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 0.5);
    expect(bgmVolume(readAudioView(engine, prefs))).toBeCloseTo(0.4);
  });

  it("静音归零（老引擎 MasterMuted 语义），取消即时恢复", () => {
    const engine = engineWithBgm(0.8);
    const prefs = new PlayerPreferences();
    prefs.setMuted(true);
    expect(bgmVolume(readAudioView(engine, prefs))).toBe(0);
    expect(readAudioView(engine, prefs).bgm?.kind).toBe("play"); // 停播语义而非 stop
    prefs.setMuted(false);
    expect(bgmVolume(readAudioView(engine, prefs))).toBeCloseTo(0.64);
  });
});

describe("渲染器偏好重规划（08 §八.2：偏好变化即时生效）", () => {
  it("偏好变化 → 合成音量差量 → play 更新（同资源不重播）", async () => {
    const engine = engineWithBgm(0.8);
    const prefs = new PlayerPreferences();
    const { port, calls } = makePort();
    const renderer = createAudioRenderer(engine, port, resources, {
      preferences: prefs,
    });
    await flush();
    expect(calls.length).toBeGreaterThanOrEqual(1); // 初始 play（合成 0.64）
    const initial = calls.find((c) => c.kind === "play");
    expect(initial?.options?.volume).toBeCloseTo(0.64);
    calls.length = 0;
    prefs.setVolume("bgm", 0.5); // 合成 0.4
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("play");
    expect(calls[0]!.options?.volume).toBeCloseTo(0.4);
    expect(calls[0]!.options?.restart).toBe(false); // 同资源音量更新，不重播
    renderer.dispose();
  });

  it("静音 → 合成音量 0 动作；取消静音即时恢复（无 stop/play 重建）", async () => {
    const engine = engineWithBgm(0.8);
    const prefs = new PlayerPreferences();
    const { port, calls } = makePort();
    const renderer = createAudioRenderer(engine, port, resources, {
      preferences: prefs,
    });
    await flush();
    calls.length = 0;
    prefs.setMuted(true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("play");
    expect(calls[0]!.options?.volume).toBe(0);
    calls.length = 0;
    prefs.setMuted(false);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("play");
    expect(calls[0]!.options?.volume).toBeCloseTo(0.64);
    renderer.dispose();
  });
});
