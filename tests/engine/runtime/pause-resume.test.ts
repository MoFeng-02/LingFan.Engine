/**
 * 引擎级暂停与恢复：幂等、等待定时器的剩余量续起、暂停期间的推进 fail-closed、
 * 媒体面按状态改写、销毁后标记退场。
 *
 * 定时面用受控 TimerPort 替身（带可控时刻），不依赖真实时钟；
 * 媒体面只看 SSOT 状态，不引真实适配器。
 */
import { describe, expect, it } from "vitest";
import type {
  AudioChannelState,
  OutboundEvent,
  TimerPort,
  ValueChanged,
} from "@lingfan-engine/core";
import {
  RESERVED_STATE_KEYS,
  SYS,
  StoryEngine,
  parseStory,
} from "@lingfan-engine/core";

interface TimerEntry {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

interface RecordingTimer {
  port: TimerPort;
  scheduled: TimerEntry[];
  cleared: TimerEntry[];
  /** 把端口时刻往前推 ms 毫秒（暂停按到期时刻减当前时刻算剩余量） */
  advanceBy: (ms: number) => void;
}

/** 受控记录型 TimerPort：调用入账、回调不自动触发、时刻可推进 */
function makeRecordingTimer(): RecordingTimer {
  const scheduled: TimerEntry[] = [];
  const cleared: TimerEntry[] = [];
  let now = 1_000_000;
  const port: TimerPort = {
    set(fn, ms) {
      const entry: TimerEntry = { fn, ms, cleared: false };
      scheduled.push(entry);
      return entry as unknown as ReturnType<TimerPort["set"]>;
    },
    clear(handle) {
      const entry = handle as unknown as TimerEntry;
      entry.cleared = true;
      cleared.push(entry);
    },
    now: () => now,
  };
  return {
    port,
    scheduled,
    cleared,
    advanceBy: (ms: number) => {
      now += ms;
    },
  };
}

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
    },
  };
}

function makeEngine(columns: object[], timer?: TimerPort): Harness {
  return instrument(
    new StoryEngine(
      parseStory({ formatVersion: 1, id: "pause", columns }),
      timer === undefined ? { rngSeed: 7 } : { rngSeed: 7, timerPort: timer },
    ),
  );
}

/** 单列故事：wait(60s) → say */
function waitStory(): object[] {
  return [
    {
      id: "start",
      kind: "flow",
      commands: [
        { op: "wait", seconds: 60 },
        { op: "say", text: "after" },
      ],
    },
  ];
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors
    .filter((e) => e.payload.kind === "engine.error")
    .map((e) => (e.payload as { code: string }).code);
}

describe("引擎级暂停与恢复", () => {
  it("pause 幂等：重复调用不重复写暂停标记、不改等待态", () => {
    const h = makeEngine(waitStory());
    try {
      h.engine.start();
      expect(h.engine.get(SYS.waiting)).toBe("wait");
      h.engine.pause();
      expect(h.engine.paused()).toBe(true);
      expect(h.engine.get(SYS.paused)).toBe(true);
      const afterFirst = h.changes.length;

      h.engine.pause();
      h.engine.pause();
      expect(h.engine.paused()).toBe(true);
      // 幂等 = 不再发状态变更：重复 pause 不产生新的观察事件
      expect(h.changes.length).toBe(afterFirst);
      expect(h.engine.get(SYS.waiting)).toBe("wait");
    } finally {
      h.dispose();
    }
  });

  it("暂停期间 advance fail-closed 报 pause-active，等待态原样保留", () => {
    const h = makeEngine(waitStory());
    try {
      h.engine.start();
      h.engine.pause();
      h.engine.advance();
      expect(errorCodes(h.errors)).toContain("pause-active");
      expect(h.engine.get(SYS.waiting)).toBe("wait");
    } finally {
      h.dispose();
    }
  });

  it("暂停期间 choose fail-closed 报 pause-active，不换列", () => {
    const h = makeEngine([
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "say", text: "前" },
          { op: "menu", options: [{ text: "甲", target: "b" }] },
        ],
      },
      { id: "b", kind: "flow", commands: [{ op: "say", text: "乙" }] },
    ]);
    try {
      h.engine.start();
      h.engine.advance();
      expect(h.engine.get(SYS.waiting)).toBe("menu");
      h.engine.pause();
      h.engine.choose("b");
      expect(errorCodes(h.errors)).toContain("pause-active");
      expect(h.engine.get(SYS.waiting)).toBe("menu");
      expect(h.engine.get(SYS.currentDialogText)).toBe("");
    } finally {
      h.dispose();
    }
  });

  it("等待定时器在 pause 时被 clear，resume 后按剩余毫秒重排（小于原始时长）", () => {
    const timer = makeRecordingTimer();
    const h = makeEngine(waitStory(), timer.port);
    try {
      h.engine.start();
      expect(timer.scheduled).toHaveLength(1);
      expect(timer.scheduled[0]!.ms).toBe(60_000);

      timer.advanceBy(20_000);
      h.engine.pause();
      // 挂起的定时器必须被取消：留着它会在暂停期间照常醒来推进故事
      expect(timer.cleared).toHaveLength(1);
      expect(timer.cleared[0]).toBe(timer.scheduled[0]);

      h.engine.resume();
      expect(timer.scheduled).toHaveLength(2);
      const resumed = timer.scheduled[1]!;
      expect(resumed.ms).toBe(40_000);
      expect(resumed.ms).toBeLessThan(timer.scheduled[0]!.ms);
    } finally {
      h.dispose();
    }
  });

  it("resume 后等待态回到暂停前的值，续起的定时器到点仍能解除等待", () => {
    const timer = makeRecordingTimer();
    const h = makeEngine(waitStory(), timer.port);
    try {
      h.engine.start();
      h.engine.pause();
      h.engine.resume();
      expect(h.engine.paused()).toBe(false);
      expect(h.engine.get(SYS.waiting)).toBe("wait");

      timer.scheduled[1]!.fn();
      expect(h.engine.get(SYS.waiting)).toBe("dialog");
      expect(h.engine.get(SYS.currentDialogText)).toBe("after");
    } finally {
      h.dispose();
    }
  });

  it("媒体面：pause 把在播通道写成暂停态，resume 写回暂停前的播放态", () => {
    const h = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "bgm", resource: "a.mp3", volume: 0.4 },
          { op: "say", text: "停" },
        ],
      },
    ]);
    const channel = (): AudioChannelState | null =>
      (h.engine.get(SYS.audioBgm) ?? null) as AudioChannelState | null;
    try {
      h.engine.start();
      expect(channel()).toMatchObject({ kind: "play", resource: "a.mp3" });

      h.engine.pause();
      expect(channel()).toMatchObject({ kind: "pause" });

      h.engine.resume();
      expect(channel()).toEqual({
        kind: "play",
        resource: "a.mp3",
        volume: 0.4,
        loop: true,
        fadeMs: 0,
      });
    } finally {
      h.dispose();
    }
  });

  it("dispose 后 paused() 为 false：暂停标记随销毁退场", () => {
    const h = makeEngine(waitStory());
    try {
      h.engine.start();
      h.engine.pause();
      expect(h.engine.paused()).toBe(true);
      h.engine.dispose();
      expect(h.engine.paused()).toBe(false);
      expect(h.engine.get(SYS.paused)).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("`__paused` 是系统键（`__` 前缀 ⇒ 保留命名空间，外部不可写）", () => {
    expect(String(SYS.paused).startsWith("__")).toBe(true);
    expect(RESERVED_STATE_KEYS.has(SYS.paused)).toBe(true);

    const h = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "set", key: SYS.paused, value: true },
          { op: "say", text: "尾" },
        ],
      },
    ]);
    try {
      h.engine.start();
      expect(errorCodes(h.errors)).toContain("reserved-key");
      expect(h.engine.get(SYS.paused)).toBeUndefined();
    } finally {
      h.dispose();
    }
  });
});
