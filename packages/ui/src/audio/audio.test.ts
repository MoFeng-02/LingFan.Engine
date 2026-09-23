/**
 * 08-U6 音频渲染层测试：状态差量 → 端口动作（纯规划器）+ 渲染器订阅/异步资源解析/回写/退订。
 * 按契约 Mock（不 Mock 实现）：AudioPort 与 ResourcePort 均为契约的可行实现，node 环境无解码器。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannel,
  AudioChannelState,
  AudioPlayOptions,
  AudioPort,
  ResourcePort,
  SaveDataV1,
} from "@lingfan/engine";
import { SYS, StoryEngine } from "@lingfan/engine";
import { parseStory } from "@lingfan/engine";
import {
  EMPTY_AUDIO_VIEW,
  createAudioRenderer,
  planAudioActions,
  type AudioView,
} from "./audio";

function play(
  resource: string,
  volume = 1,
  loop = true,
  fadeMs = 0,
  seq?: number,
  restart?: boolean,
): AudioChannelState {
  return {
    kind: "play",
    resource,
    volume,
    loop,
    fadeMs,
    ...(seq === undefined ? {} : { seq }),
    ...(restart === undefined ? {} : { restart }),
  };
}

function view(partial: Partial<AudioView>): AudioView {
  return { ...EMPTY_AUDIO_VIEW, ...partial };
}

interface Call {
  kind: "play" | "stop";
  channel: AudioChannel;
  url?: string;
  options?: AudioPlayOptions;
  fadeMs?: number;
}

function makePort(): {
  port: AudioPort;
  calls: Call[];
  setPosition: (seconds: number) => void;
} {
  const calls: Call[] = [];
  let position = 0;
  return {
    calls,
    setPosition: (seconds: number) => {
      position = seconds;
    },
    port: {
      play: (channel, url, options) =>
        calls.push({ kind: "play", channel, url, options }),
      stop: (channel, fadeMs) => calls.push({ kind: "stop", channel, fadeMs }),
      position: () => position,
      dispose: () => undefined,
    },
  };
}

interface ResourceHarness {
  port: ResourcePort;
  released: string[];
  resolveCalls: string[];
  settle: (id: string, url?: string) => void;
  fail: (id: string) => void;
}

/** deferred=true 时解析挂起，由 settle 手动放行（竞态用例） */
function makeResources(deferred = false): ResourceHarness {
  const released: string[] = [];
  const resolveCalls: string[] = [];
  const waiters = new Map<string, (url: string) => void>();
  const failures = new Set<string>();
  return {
    released,
    resolveCalls,
    settle: (id, url) => {
      waiters.get(id)?.(url ?? `/${id}`);
      waiters.delete(id);
    },
    fail: (id) => failures.add(id),
    port: {
      resolve(id) {
        resolveCalls.push(id);
        if (failures.has(id)) return Promise.reject(new Error(`缺失：${id}`));
        if (!deferred) return Promise.resolve(`/${id}`);
        return new Promise<string>((resolve) => waiters.set(id, resolve));
      },
      release(url) {
        released.push(url);
      },
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("状态差量 → 端口动作（锚点: four-audio-channels）", () => {
  it("空视图起步：常驻通道与一次性触发各出一次 play（新资源 = 重播）", () => {
    const actions = planAudioActions(
      EMPTY_AUDIO_VIEW,
      view({
        bgm: play("bgm.mp3", 0.5, true, 300),
        ambient: play("rain.mp3", 0.2),
        voice: play("line.mp3", 1, false),
        se: play("click.mp3", 0.8, false, 0, 1),
      }),
    );
    expect(actions).toEqual([
      {
        type: "play",
        channel: "bgm",
        resource: "bgm.mp3",
        volume: 0.5,
        loop: true,
        position: 0,
        fadeMs: 300,
        restart: true,
      },
      {
        type: "play",
        channel: "ambient",
        resource: "rain.mp3",
        volume: 0.2,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
      {
        type: "play",
        channel: "voice",
        resource: "line.mp3",
        volume: 1,
        loop: false,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
      {
        type: "play",
        channel: "se",
        resource: "click.mp3",
        volume: 0.8,
        loop: false,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("同资源同参数不产生动作（无缝续播）；音量/循环变化只更新不重播", () => {
    const before = view({ bgm: play("bgm.mp3", 0.5) });
    expect(
      planAudioActions(before, view({ bgm: play("bgm.mp3", 0.5) })),
    ).toEqual([]);
    expect(
      planAudioActions(before, view({ bgm: play("bgm.mp3", 0.9) })),
    ).toEqual([
      {
        type: "play",
        channel: "bgm",
        resource: "bgm.mp3",
        volume: 0.9,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: false,
      },
    ]);
    expect(
      planAudioActions(before, view({ bgm: play("bgm.mp3", 0.5, false) })),
    ).toHaveLength(1);
  });

  it("同资源显式 restart（seq 变化）→ 回到起点重播；陈旧状态不重播", () => {
    const before = view({ bgm: play("bgm.mp3", 0.5, true, 0, 7, true) });
    // 同 seq = 同一状态重放（如读档后 sync）：不得再次重播
    expect(
      planAudioActions(
        before,
        view({ bgm: play("bgm.mp3", 0.5, true, 0, 7, true) }),
      ),
    ).toEqual([]);
    expect(
      planAudioActions(
        before,
        view({ bgm: play("bgm.mp3", 0.5, true, 0, 8, true) }),
      ),
    ).toEqual([
      {
        type: "play",
        channel: "bgm",
        resource: "bgm.mp3",
        volume: 0.5,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("换资源 = 新曲目；停止形态 = stop 且带淡出参数", () => {
    const before = view({ ambient: play("rain.mp3", 0.3) });
    expect(
      planAudioActions(before, view({ ambient: play("wind.mp3", 0.3) })),
    ).toEqual([
      {
        type: "play",
        channel: "ambient",
        resource: "wind.mp3",
        volume: 0.3,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
    expect(
      planAudioActions(
        before,
        view({ ambient: { kind: "stop", fadeMs: 400 } }),
      ),
    ).toEqual([{ type: "stop", channel: "ambient", fadeMs: 400 }]);
    expect(planAudioActions(before, view({ ambient: null }))).toEqual([
      { type: "stop", channel: "ambient", fadeMs: 0 },
    ]);
  });

  it("四通道独立：只改一路时其余零动作", () => {
    const before = view({
      bgm: play("bgm.mp3"),
      ambient: play("rain.mp3"),
      voice: play("v.mp3", 1, false),
    });
    const after = view({
      bgm: play("bgm.mp3"),
      ambient: play("wind.mp3"),
      voice: play("v.mp3", 1, false),
    });
    expect(planAudioActions(before, after)).toEqual([
      {
        type: "play",
        channel: "ambient",
        resource: "wind.mp3",
        volume: 1,
        loop: true,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("voice 互斥单槽：换语音只出一次 play（不叠放）", () => {
    const actions = planAudioActions(
      view({ voice: play("a.mp3", 1, false) }),
      view({ voice: play("b.mp3", 1, false) }),
    );
    expect(actions).toEqual([
      {
        type: "play",
        channel: "voice",
        resource: "b.mp3",
        volume: 1,
        loop: false,
        position: 0,
        fadeMs: 0,
        restart: true,
      },
    ]);
  });

  it("se 按触发序号判定：同序号零动作、新序号触发、空状态不触发", () => {
    const before = view({ se: play("click.mp3", 0.8, false, 0, 1) });
    expect(
      planAudioActions(
        before,
        view({ se: play("click.mp3", 0.8, false, 0, 1) }),
      ),
    ).toEqual([]);
    expect(
      planAudioActions(
        before,
        view({ se: play("click.mp3", 0.8, false, 0, 2) }),
      ),
    ).toHaveLength(1);
    expect(planAudioActions(before, EMPTY_AUDIO_VIEW)).toEqual([]);
  });

  it("bgm 位置差超阈值才定位（回滚 seek），阈值内视为播放器噪声", () => {
    const before = view({ bgm: play("bgm.mp3"), bgmPosition: 10 });
    expect(
      planAudioActions(
        before,
        view({ bgm: play("bgm.mp3"), bgmPosition: 10.2 }),
      ),
    ).toEqual([]);
    const seek = planAudioActions(
      before,
      view({ bgm: play("bgm.mp3"), bgmPosition: 40 }),
    );
    expect(seek).toEqual([
      {
        type: "play",
        channel: "bgm",
        resource: "bgm.mp3",
        volume: 1,
        loop: true,
        position: 40,
        fadeMs: 0,
        restart: false,
      },
    ]);
  });

  it("换曲按目标位置起播（读档续播：位置随存档恢复）", () => {
    const actions = planAudioActions(
      view({ bgm: play("a.mp3") }),
      view({ bgm: play("b.mp3"), bgmPosition: 35.2 }),
    );
    expect(actions[0]).toMatchObject({
      channel: "bgm",
      position: 35.2,
      restart: true,
    });
  });

  it("畸形状态（kind 非 play/stop）视为无媒体：绝不翻译成播放", () => {
    const garbage = { kind: "evil" } as unknown as AudioChannelState;
    expect(planAudioActions(EMPTY_AUDIO_VIEW, view({ bgm: garbage }))).toEqual(
      [],
    );
    expect(
      planAudioActions(view({ bgm: garbage }), view({ bgm: garbage })),
    ).toEqual([]);
    expect(
      planAudioActions(view({ bgm: play("a.mp3") }), view({ bgm: garbage })),
    ).toEqual([{ type: "stop", channel: "bgm", fadeMs: 0 }]);
  });
});

describe("音频渲染器（订阅 + 异步资源解析 + 帧级回写 + 退订）", () => {
  function makeStoryEngine(commands: object[]): StoryEngine {
    return new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "audio-ui",
        columns: [{ id: "start", kind: "flow", commands }],
      }),
      { rngSeed: 3 },
    );
  }

  it("订阅驱动：引擎写状态即触发端口动作；推进后 auto_stop 停语音", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/bgm.mp3", volume: 0.5 },
      { op: "say", text: "一", voice: "Audio/line1.mp3" },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    expect(calls).toEqual([]); // 尚未启动：无媒体状态

    engine.start();
    await flush();
    expect(calls).toEqual([
      {
        kind: "play",
        channel: "bgm",
        url: "/Audio/bgm.mp3",
        options: {
          volume: 0.5,
          loop: true,
          position: 0,
          fadeMs: 0,
          restart: true,
        },
      },
      {
        kind: "play",
        channel: "voice",
        url: "/Audio/line1.mp3",
        options: {
          volume: 1,
          loop: false,
          position: 0,
          fadeMs: 0,
          restart: true,
        },
      },
    ]);

    engine.advance(); // 08 §六.1 auto_stop：推进过该句 → 语音停
    await flush();
    expect(calls.at(-1)).toEqual({
      kind: "stop",
      channel: "voice",
      fadeMs: 0,
    });
    renderer.dispose();
    engine.dispose();
  });

  it("同资源重写复用已解析 URL（不重复解析）；restart 传到端口", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/a.mp3" },
      { op: "say", text: "一" },
      { op: "bgm", resource: "Audio/a.mp3", restart: true },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    engine.advance();
    await flush();

    expect(resources.resolveCalls).toEqual(["Audio/a.mp3"]); // 只解析一次
    expect(calls).toHaveLength(2);
    expect(calls[0]?.options?.restart).toBe(true);
    expect(calls[1]?.options?.restart).toBe(true); // 显式重播
    renderer.dispose();
    engine.dispose();
  });

  it("竞态：快速换曲时迟到的旧解析结果被丢弃（不误播）", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/a.mp3" },
      { op: "say", text: "一" },
      { op: "bgm", resource: "Audio/b.mp3" },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources(true); // 解析挂起
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start(); // 请求 a（挂起）
    engine.advance(); // 换曲 b（挂起）
    resources.settle("Audio/a.mp3"); // 旧解析迟到
    await flush();
    expect(calls).toEqual([]); // 代际已更新 → a 被丢弃
    resources.settle("Audio/b.mp3");
    await flush();
    expect(calls).toEqual([
      {
        kind: "play",
        channel: "bgm",
        url: "/Audio/b.mp3",
        options: {
          volume: 1,
          loop: true,
          position: 0,
          fadeMs: 0,
          restart: true,
        },
      },
    ]);
    renderer.dispose();
    engine.dispose();
  });

  it("解析失败 fail-closed：不播放且诊断上报（不静默）", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/missing.mp3" },
      { op: "say", text: "一" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    resources.fail("Audio/missing.mp3");
    const messages: string[] = [];
    const renderer = createAudioRenderer(engine, port, resources.port, {
      onError: (m) => messages.push(m),
    });
    engine.start();
    await flush();
    expect(calls).toEqual([]);
    expect(messages[0]).toContain("资源解析失败");
    renderer.dispose();
    engine.dispose();
  });

  it("dispose 释放已解析资源（Blob 场景不泄漏）", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/a.mp3" },
      { op: "say", text: "一" },
    ]);
    const { port } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    renderer.dispose();
    expect(resources.released).toEqual(["/Audio/a.mp3"]);
    renderer.dispose(); // 二次释放无副作用（缓存已清）
    expect(resources.released).toEqual(["/Audio/a.mp3"]);
    engine.dispose();
  });

  it("pollPosition 回写帧级键；视图同步后不产生多余 seek", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/bgm.mp3" },
      { op: "say", text: "一" },
    ]);
    const { port, calls, setPosition } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    calls.length = 0;

    setPosition(42.5);
    renderer.pollPosition();
    expect(engine.get(SYS.bgmPosition)).toBe(42.5);
    renderer.sync(); // 自身回写不得被当成 seek 目标
    await flush();
    expect(calls).toEqual([]);
    renderer.dispose();
    engine.dispose();
  });

  it("无 bgm 时不回写（空通道位置噪声不入档）", () => {
    const engine = makeStoryEngine([{ op: "say", text: "一" }]);
    const { port, setPosition } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    setPosition(9);
    renderer.pollPosition();
    expect(engine.get(SYS.bgmPosition)).toBeUndefined();
    renderer.dispose();
    engine.dispose();
  });

  it("dispose 退订：之后引擎状态变化不再驱动端口", async () => {
    const engine = makeStoryEngine([
      { op: "say", text: "一" },
      { op: "bgm", resource: "Audio/bgm.mp3" },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    renderer.dispose();
    calls.length = 0;
    engine.advance(); // 触发 bgm play —— 已退订，不应再调用端口
    await flush();
    expect(calls).toEqual([]);
    engine.dispose();
  });

  it("stop 形态带淡出：stop_ambient fade=400 → 端口收到 400ms 淡出", async () => {
    const engine = makeStoryEngine([
      { op: "ambient", resource: "Audio/rain.mp3" },
      { op: "say", text: "一" },
      { op: "stop_ambient", fade: 400 },
      { op: "say", text: "二" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    expect(calls).toEqual([
      {
        kind: "play",
        channel: "ambient",
        url: "/Audio/rain.mp3",
        options: {
          volume: 1,
          loop: true,
          position: 0,
          fadeMs: 0,
          restart: true,
        },
      },
    ]);
    engine.advance();
    await flush();
    expect(calls.at(-1)).toEqual({
      kind: "stop",
      channel: "ambient",
      fadeMs: 400,
    });
    renderer.dispose();
    engine.dispose();
  });

  it("同一轮内先播后停：合并为停止（不产生无意义的瞬时播放）", async () => {
    const engine = makeStoryEngine([
      { op: "ambient", resource: "Audio/rain.mp3" },
      { op: "stop_ambient", fade: 400 },
      { op: "say", text: "一" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    // 目标态已是停止：在途的 play 被代际取消，只剩停止
    expect(calls).toEqual([{ kind: "stop", channel: "ambient", fadeMs: 400 }]);
    renderer.dispose();
    engine.dispose();
  });

  it("篡改存档注入畸形媒体状态 → 端口只收到安全动作（无非法播放）", async () => {
    const engine = makeStoryEngine([
      { op: "bgm", resource: "Audio/bgm.mp3" },
      { op: "say", text: "一" },
    ]);
    const { port, calls } = makePort();
    const resources = makeResources();
    const renderer = createAudioRenderer(engine, port, resources.port);
    engine.start();
    await flush();
    calls.length = 0;

    const data = engine.exportSave();
    expect(data).not.toBeNull();
    const tampered = JSON.parse(JSON.stringify(data)) as SaveDataV1;
    tampered.state = tampered.state.map(([key, value]) =>
      key === SYS.audioBgm
        ? [key, { kind: "evil", resource: 42 }]
        : [key, value],
    );
    expect(engine.importSave(tampered)).toBe(true);
    renderer.sync();
    await flush();

    // 畸形通道降级为「无媒体」：相对上一帧 play 只产生一次停止，且绝无非法资源播放
    expect(calls).toEqual([{ kind: "stop", channel: "bgm", fadeMs: 0 }]);
    renderer.dispose();
    engine.dispose();
  });
});
