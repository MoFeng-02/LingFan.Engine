/**
 * playground 元素回写接线：锁住「控件滑块的值真的落到既有闸门」。
 *
 * 这条链有三段，坏掉的方式各不相同，故分三层验：
 * - **判定层**：`cmd` 落点形态归共享判定点 `routeElementValueChange`（`packages/ui`），
 *   playground 不得自己再判一遍 `volume:` / `game.` 前缀——两份判定必然漂移。
 * - **接线层**：元素层把 `writeback` 端口透传给 `renderElementTree` 的
 *   `onElementValueChange`；不传 = 控件可拖但值不落地（表现为「拖了没反应」）。
 * - **落点层**：音量进 `preferences.setVolume`（钳制归偏好层）、玩法进
 *   `gameState.setScoped`（保留键与 JSON 安全由引擎写入契约把关）。
 *
 * 落点层用真 `PlayerPreferences` + 真 `StoryEngine` 跑，不打桩：
 * 「回写落到既有闸门」这句话的全部价值就在于闸门是真闸门。
 * 源码层用 `?raw` 读文本，不碰 fs（本仓测试统一口径）。
 */
import { describe, expect, it } from "vitest";
import {
  PlayerPreferences,
  SYS,
  StoryEngine,
  parseStory,
  type AudioChannel,
  type ElementInstance,
} from "@lingfan-engine/core";
import {
  routeElementValueChange,
  type ElementWritebackPorts,
} from "@lingfan-engine/ui";
import elementsSource from "../../apps/playground/src/host/stage/elements/elements.ts?raw";
import layerSource from "../../apps/playground/src/host/stage/elements/app-element-layer.ts?raw";

/** 只带判定所需字段的元素剖面（回写只看 id 与 props.cmd） */
function elementWith(cmd: unknown): ElementInstance {
  return {
    id: "volume-slider",
    type: "slider",
    z: 0,
    children: [],
    props: cmd === undefined ? {} : { cmd },
  };
}

/** 记录端口：把「落到哪」变成可断言的数组 */
function makePorts(): { ports: ElementWritebackPorts; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ports: {
      setVolume(channel: AudioChannel, value: number) {
        log.push(`volume|${channel}|${String(value)}`);
      },
      setScoped(systemId: string, key: string, value: unknown) {
        log.push(`scoped|${systemId}|${key}|${String(value)}`);
        return true;
      },
      reportError(message: string) {
        log.push(`error|${message.slice(0, 12)}`);
      },
    },
  };
}

describe("playground 元素回写 · 判定层", () => {
  it("volume:<通道> 落到音量端口，值与通道原样透传", () => {
    const { ports, log } = makePorts();
    const ok = routeElementValueChange(elementWith("volume:bgm"), 0.35, ports);
    expect(ok).toBe(true);
    expect(log).toEqual(["volume|bgm|0.35"]);
  });

  it("四通道各走各的（回写不按通道排队，互不影响）", () => {
    const { ports, log } = makePorts();
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      routeElementValueChange(elementWith(`volume:${channel}`), 0.5, ports);
    }
    expect(log).toEqual([
      "volume|bgm|0.5",
      "volume|se|0.5",
      "volume|ambient|0.5",
      "volume|voice|0.5",
    ]);
  });

  it("game.<系统>.<键> 落到命名空间写入面；非三段报错不落地", () => {
    const { ports, log } = makePorts();
    routeElementValueChange(elementWith("game.puzzle.score"), 10, ports);
    expect(log).toEqual(["scoped|puzzle|score|10"]);

    log.length = 0;
    routeElementValueChange(elementWith("game.puzzle"), 10, ports);
    routeElementValueChange(elementWith("game.puzzle.score.extra"), 10, ports);
    expect(log.filter((line) => line.startsWith("scoped|"))).toEqual([]);
    expect(log.filter((line) => line.startsWith("error|"))).toHaveLength(2);
  });

  it("没有 cmd 的控件不落地，但**上报诊断**（不静默吞，否则表现为「拖了没反应」）", () => {
    const { ports, log } = makePorts();
    expect(routeElementValueChange(elementWith(undefined), 0.5, ports)).toBe(
      false,
    );
    // 不落地 + 无诊断 = 作者永远查不出为什么滑块不动，所以这里必须有诊断
    expect(log.filter((line) => line.startsWith("volume|"))).toEqual([]);
    expect(log.filter((line) => line.startsWith("error|"))).toHaveLength(1);
  });

  it("音量的非有限数被拒（NaN 进偏好层会被静默忽略，那等于悄悄不生效）", () => {
    const { ports, log } = makePorts();
    expect(
      routeElementValueChange(elementWith("volume:bgm"), Number.NaN, ports),
    ).toBe(false);
    expect(log.filter((line) => line.startsWith("volume|"))).toEqual([]);
    expect(log.filter((line) => line.startsWith("error|"))).toHaveLength(1);
  });
});

describe("playground 元素回写 · 接线层（源码互锁）", () => {
  it("元素层把回写端口透传给渲染树，且判定归共享点不自己判前缀", () => {
    expect(elementsSource).toContain("onElementValueChange:");
    expect(elementsSource).toContain("routeElementValueChange");
    // 本层不得出现自己拼前缀的判据：`"volume:"` 字面量只许在共享判定点里
    expect(elementsSource).not.toContain('"volume:"');
    expect(elementsSource).not.toContain('startsWith("game.")');
  });

  it("组合根把偏好与玩法写入面接进端口（两件都是既有闸门）", () => {
    expect(layerSource).toContain("preferences.setVolume(");
    expect(layerSource).toContain("setScoped(");
    expect(layerSource).toContain("gameState");
    // 不得新开写入面：元素回写不许直写引擎状态键
    expect(layerSource).not.toContain("setSilent(");
    expect(layerSource).not.toContain("setGlobal(");
  });
});

describe("playground 元素回写 · 落点层（真闸门）", () => {
  function makeEngine(): StoryEngine {
    return new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "playground-writeback",
        columns: [{ id: "start", kind: "flow", commands: [] }],
      }),
      { rngSeed: 9 },
    );
  }

  it("音量落到偏好层：钳制与静音合成都在偏好层，不在这里重复", () => {
    const preferences = new PlayerPreferences();
    const { log } = makePorts();
    // 端口换真实现，路径与 app-element-layer.ts 一致
    const ports: ElementWritebackPorts = {
      setVolume: (channel, value) => {
        preferences.setVolume(channel, value);
      },
      setScoped: () => true,
      reportError: (message) => {
        log.push(`error|${message}`);
      },
    };
    // 越界值：偏好层钳到 1，回写层不得报错也不得自己钳
    expect(routeElementValueChange(elementWith("volume:bgm"), 7, ports)).toBe(
      true,
    );
    expect(preferences.volume("bgm")).toBe(1);
    expect(log).toEqual([]);
  });

  it("玩法状态落到 game. 命名空间：可与作者变量并存，且读得回来", () => {
    const engine = makeEngine();
    const ports: ElementWritebackPorts = {
      setVolume: () => undefined,
      setScoped: (systemId, key, value) =>
        engine.gameState.setScoped(systemId, key, value),
      reportError: () => undefined,
    };
    expect(
      routeElementValueChange(elementWith("game.puzzle.score"), 42, ports),
    ).toBe(true);
    expect(engine.get("game.puzzle.score")).toBe(42);
    // 保留键仍被拒：回写走的是同一道闸门，不是绕过它
    const before = engine.get(SYS.audioBgm);
    expect(engine.gameState.setScoped("puzzle", "__audio_bgm", 1)).toBe(true);
    expect(engine.get(SYS.audioBgm)).toBe(before);
  });
});
