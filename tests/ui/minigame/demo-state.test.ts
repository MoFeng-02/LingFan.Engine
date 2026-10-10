/**
 * 演示小游戏消费 state 通道的聚焦测试：
 * createMinigameRegistry + createClick3Demo（真实演示工厂）+ StoryEngine 组合成完整链路——
 * 故事 minigame 命令 → mount 载荷（config/signal/seq）→ 演示工厂回填 → resolveMinigame
 * → state 逐键落 `game.<gameId>.<key>`，可被 engine.get 读到。
 * node 环境无 DOM：按 tests/ui 既有口径给假 document 替身（同 overlay.test.ts）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MinigameMountPayload,
  MinigameResult,
  OutboundEvent,
} from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";
import { createMinigameRegistry } from "@lingfan/ui";
import { createClick3Demo } from "../../../apps/playground/src/host/minigame-demo";

interface Harness {
  engine: StoryEngine;
  events: OutboundEvent[];
  dispose: () => void;
}

function makeEngine(columns: object[]): Harness {
  const events: OutboundEvent[] = [];
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "demo-state", entry: "a", columns }),
  );
  const offEvent = engine.onEvent((e) => events.push(e));
  return {
    engine,
    events,
    dispose: () => {
      offEvent();
      engine.dispose();
    },
  };
}

function mounts(events: OutboundEvent[]): MinigameMountPayload[] {
  return events.flatMap((e) =>
    e.payload.kind === "minigame.mount" ? [e.payload] : [],
  );
}

/** 够用即止的假元素：click3 工厂只用 className/textContent/type/监听器/append */
interface FakeEl {
  tag: string;
  className: string;
  textContent: string;
  type: string;
  children: FakeEl[];
  listeners: Record<string, Array<() => void>>;
  append(...children: unknown[]): void;
  addEventListener(type: string, handler: () => void): void;
}

function createEl(tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    className: "",
    textContent: "",
    type: "",
    children: [],
    listeners: {},
    append(...children) {
      el.children.push(...(children as FakeEl[]));
    },
    addEventListener(type, handler) {
      el.listeners[type] ??= [];
      el.listeners[type].push(handler);
    },
  };
  return el;
}

describe("演示工厂消费 state 通道（registry + 引擎全链路）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("click3 回传的 state 逐键落 game.click3.*，engine.get 可读；score 行为不变", async () => {
    vi.stubGlobal("document", { createElement: (tag: string) => createEl(tag) });

    const registry = createMinigameRegistry();
    const marked: unknown[] = [];
    registry.register(
      "click3",
      createClick3Demo({
        markHost: (h) => {
          marked.push(h);
        },
      }),
    );

    const h = makeEngine([
      {
        id: "a",
        kind: "flow",
        commands: [
          {
            op: "minigame",
            game: "click3",
            config: { target: 3 },
            on_success: "win",
            on_fail: "lose",
          },
        ],
      },
      { id: "win", kind: "flow", commands: [{ op: "say", text: "通关" }] },
      { id: "lose", kind: "flow", commands: [{ op: "say", text: "失败" }] },
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("minigame");

    const [mount] = mounts(h.events);
    expect(mount?.game).toBe("click3");
    expect(mount?.seq).toBe(1);
    expect(mount?.config).toEqual({ target: 3 });

    // ctx 与宿主 minigame.mount 分支同形：config/signal/seq 全部取自 mount 载荷
    const host = createEl("div") as unknown as HTMLElement;
    (host as unknown as { innerHTML: string }).innerHTML = "";
    const pending = registry.get("click3")!(host, {
      config: mount!.config,
      signal: mount!.signal,
      seq: mount!.seq,
    });
    expect(marked).toEqual([host]);

    // 点够 target 次：走真实按钮监听路径驱动完成
    const hostFake = host as unknown as FakeEl;
    const button = hostFake.children.find((c) => c.tag === "button");
    expect(button).toBeDefined();
    for (let i = 0; i < 3; i += 1) button!.listeners.click![0]();

    const result: MinigameResult = await pending;
    expect(result).toEqual({
      outcome: "success",
      score: 3,
      state: { clicks: 3, target: 3 },
    });

    expect(h.engine.resolveMinigame(result)).toBe(true);
    expect(h.engine.get("game.click3.clicks")).toBe(3);
    expect(h.engine.get("game.click3.target")).toBe(3);
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("win");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });
});
