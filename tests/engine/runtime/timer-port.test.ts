/**
 * 定时器端口测试：注入实现、句柄取消、缺省兜底三面。
 * 缺省路径（hostTimer + fake timers）已由 engine.test.ts 的 wait/pause 组与
 * preferences.test.ts 的防抖组覆盖；这里只测注入面——宿主自己的 TimerPort
 * 是否被全链使用（set + clear 都走端口）。
 */
import { describe, expect, it } from "vitest";
import { SYS, StoryEngine, parseStory, hostTimer } from "@lingfan/engine";
import type { TimerPort } from "@lingfan/engine";

interface TimerEntry {
  fn: () => void;
  ms: number;
  cleared: boolean;
}

/** 受控记录型 TimerPort：全部调用入账，回调不自动触发（测试手动 fire） */
function makeRecordingTimer(): {
  port: TimerPort;
  scheduled: TimerEntry[];
  cleared: TimerEntry[];
} {
  const scheduled: TimerEntry[] = [];
  const cleared: TimerEntry[] = [];
  const port: TimerPort = {
    set(fn, ms) {
      const entry: TimerEntry = { fn, ms, cleared: false };
      scheduled.push(entry);
      return entry as unknown as ReturnType<typeof hostTimer.set>;
    },
    clear(handle) {
      const entry = handle as unknown as TimerEntry;
      entry.cleared = true;
      cleared.push(entry);
    },
  };
  return { port, scheduled, cleared };
}

function makeStoryEngine(timer: TimerPort): StoryEngine {
  const json: unknown = {
    formatVersion: 1,
    id: "demo",
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "wait", seconds: 60 },
          { op: "say", text: "after" },
        ],
      },
    ],
  };
  return new StoryEngine(parseStory(json), { timerPort: timer });
}

describe("TimerPort 注入（wait 定时面）", () => {
  it("wait 走注入端口 set；到点手动触发后解除等待并推进", () => {
    const { port, scheduled } = makeRecordingTimer();
    const engine = makeStoryEngine(port);
    engine.start();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.ms).toBe(60_000);
    expect(engine.get(SYS.waiting)).toBe("wait");

    scheduled[0]!.fn();
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("after");
  });

  it("非 skipable 的 wait：advance 不清定时器，端口 clear 零调用", () => {
    const { port, scheduled, cleared } = makeRecordingTimer();
    const engine = makeStoryEngine(port);
    engine.start();
    engine.advance();
    expect(cleared).toHaveLength(0);
    expect(engine.get(SYS.waiting)).toBe("wait");
    scheduled[0]!.fn();
    expect(engine.get(SYS.currentDialogText)).toBe("after");
  });

  it("skipable wait 被 advance 解除时经端口 clear，已 clear 的回调被防御", () => {
    const { port, scheduled, cleared } = makeRecordingTimer();
    const json: unknown = {
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "wait", seconds: 60, skipable: true },
            { op: "say", text: "after" },
          ],
        },
      ],
    };
    const engine = new StoryEngine(parseStory(json), { timerPort: port });
    engine.start();
    expect(scheduled).toHaveLength(1);
    engine.advance();
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.cleared).toBe(true);
    expect(cleared[0]).toBe(scheduled[0]);
    expect(engine.get(SYS.currentDialogText)).toBe("after");
  });
});
