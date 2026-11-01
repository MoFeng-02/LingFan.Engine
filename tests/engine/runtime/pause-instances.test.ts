/**
 * 引擎级暂停对**音频实例族**（`SYS.audioInstances`）的覆盖。
 *
 * 实例与四通道是两张并存的表：暂停只改通道会留下「引擎已暂停、作者编排的
 * 环境音还在放」的破窗，所以 `pause` 必须把实例也逐个收声、`resume` 再逐个续上。
 * 记账与通道共用 `SYS.audioPaused`，实例 id 带 `inst:` 前缀——实例 id 的合法
 * 字符集与通道名同源（`bgm`/`ambient` 都能当实例名），裸 id 作键会让通道恢复
 * 读到同名实例的播放态。
 *
 * 端口侧动作（`pauseInstance?` / `resumeInstance?`）由渲染层差量下发，
 * 见 `tests/ui/audio/audio-instances.test.ts`；本文件只锁 SSOT。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  AudioInstanceTable,
  OutboundEvent,
} from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

class ProbeEngine extends StoryEngine {
  /** 开一条只写口：模拟「暂停期间外部把实例停掉」这类不经过命令流的状态改动 */
  writeSystem(key: string, value: unknown): void {
    this.setSystem(key, value);
  }
}

interface Harness {
  engine: ProbeEngine;
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: ProbeEngine): Harness {
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

/** 起两个实例（一个环境音、一个音效）然后停在一句台词上 */
function instanceCommands(): object[] {
  return [
    {
      op: "audio_play",
      inst: "rain",
      channel: "ambient",
      resource: "rain.ogg",
      volume: 0.3,
    },
    { op: "audio_play", inst: "wind", channel: "se", resource: "wind.ogg" },
    { op: "say", text: "停在这里" },
  ];
}

function makeEngine(commands: object[]): Harness {
  const engine = new ProbeEngine(
    parseStory({
      formatVersion: 1,
      id: "pause-instances",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 5 },
  );
  const harness = instrument(engine);
  engine.start();
  return harness;
}

function tableOf(engine: StoryEngine): AudioInstanceTable {
  return (engine.get(SYS.audioInstances) ?? {}) as AudioInstanceTable;
}

function stateOf(
  engine: StoryEngine,
  id: string,
): AudioChannelState | undefined {
  return tableOf(engine)[id]?.state;
}

function pausedTableOf(engine: StoryEngine): Record<string, AudioChannelState> {
  return (engine.get(SYS.audioPaused) ?? {}) as Record<
    string,
    AudioChannelState
  >;
}

function errorCodes(errors: OutboundEvent[]): string[] {
  const codes: string[] = [];
  for (const event of errors) {
    if (event.payload.kind === "engine.error") codes.push(event.payload.code);
  }
  return codes;
}

describe("引擎暂停 · 音频实例族", () => {
  it("pause 把在播实例改成暂停态，并把暂停前的播放态记账", () => {
    const h = makeEngine(instanceCommands());
    try {
      expect(stateOf(h.engine, "rain")).toMatchObject({
        kind: "play",
        resource: "rain.ogg",
      });
      expect(stateOf(h.engine, "wind")).toMatchObject({ kind: "play" });

      h.engine.pause();

      // 状态：整表替换成 pause，资源不留在 pause 态里（与通道同口径）
      expect(stateOf(h.engine, "rain")).toMatchObject({ kind: "pause" });
      expect(stateOf(h.engine, "wind")).toMatchObject({ kind: "pause" });
      for (const id of ["rain", "wind"]) {
        const state = stateOf(h.engine, id);
        expect(state?.seq).toBeTypeOf("number");
        expect(state === undefined ? null : "resource" in state).toBe(false);
      }

      // 记账：键带实例前缀，值是暂停前那个 play 态本身
      const paused = pausedTableOf(h.engine);
      expect(paused["inst:rain"]).toMatchObject({
        kind: "play",
        resource: "rain.ogg",
      });
      expect(paused["inst:wind"]).toMatchObject({
        kind: "play",
        resource: "wind.ogg",
      });
      // 通道名不会被实例占用：三个常驻通道本来就没在播，不应出现键
      expect(paused.bgm).toBeUndefined();
      expect(paused.ambient).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it("resume 把实例写回暂停前的播放态，seq 递增表示这是一次新的续播", () => {
    const h = makeEngine(instanceCommands());
    try {
      h.engine.pause();
      const pausedState = stateOf(h.engine, "rain");
      const pausedSeq = pausedState?.seq;
      expect(pausedSeq).toBeTypeOf("number");

      h.engine.resume();

      const resumed = stateOf(h.engine, "rain");
      expect(resumed).toEqual({
        kind: "play",
        resource: "rain.ogg",
        volume: 0.3,
        loop: true,
        fadeMs: 0,
        seq: expect.any(Number),
      });
      expect(resumed?.seq).toBeGreaterThan(pausedSeq as number);
      // 实例记账被消费掉，不留在表里等下次误读
      expect(pausedTableOf(h.engine)["inst:rain"]).toBeUndefined();
      expect(pausedTableOf(h.engine)["inst:wind"]).toBeUndefined();
    } finally {
      h.dispose();
    }
  });

  it("暂停期间被停掉的实例不会复活：恢复只续上仍是 pause 态的那些", () => {
    const h = makeEngine(instanceCommands());
    try {
      h.engine.pause();

      // 模拟暂停期间实例被命令停掉（直接改表：命令流在暂停下 fail-closed）
      const stoppedAt = 900;
      h.engine.writeSystem(SYS.audioInstances, {
        ...tableOf(h.engine),
        wind: {
          channel: "se",
          state: { kind: "stop", fadeMs: 0, seq: stoppedAt },
        },
      });

      h.engine.resume();

      expect(stateOf(h.engine, "rain")).toMatchObject({ kind: "play" });
      expect(stateOf(h.engine, "wind")).toEqual({
        kind: "stop",
        fadeMs: 0,
        seq: stoppedAt,
      });
    } finally {
      h.dispose();
    }
  });

  it("暂停不依赖端口：没有实例暂停能力的宿主同样不报错，状态照常改写", () => {
    // 引擎侧从不下发端口调用——实例暂停只是 SSOT 改写，端口动作由渲染层差量产生。
    // 所以「端口未实现 pauseInstance」在这里表现为：全程零错误事件、状态正确。
    const h = makeEngine(instanceCommands());
    try {
      h.engine.pause();
      h.engine.resume();
      expect(errorCodes(h.errors)).toEqual([]);
      expect(stateOf(h.engine, "rain")).toMatchObject({ kind: "play" });
      expect(stateOf(h.engine, "wind")).toMatchObject({ kind: "play" });
    } finally {
      h.dispose();
    }
  });

  it("幂等：重复 pause 不再改动已暂停的实例（seq 不变）", () => {
    const h = makeEngine(instanceCommands());
    try {
      h.engine.pause();
      const first = stateOf(h.engine, "rain");
      h.engine.pause();
      expect(stateOf(h.engine, "rain")).toEqual(first);
    } finally {
      h.dispose();
    }
  });
});
