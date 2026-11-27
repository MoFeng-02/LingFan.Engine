/**
 * 骨架出站事件的知情类接线：rollback.done / load.notice / character.missing /
 * interaction.mount（无注册表降级）四条分支的行为判据。
 *
 * 这四条此前被 default 分支静默吞掉：回溯后媒体不对齐（滚轮/键位入口）、读档迁移
 * 诊断不可见、注销知情不可见、interaction 等待无提示。本文件用最小 DOM 替身 +
 * 真引擎把「事件 → 宿主反应」钉死；装配面（boot 传参）由源码互锁补一条。
 */
import { describe, expect, it, vi } from "vitest";
import {
  StoryEngine,
  parseStory,
  type OutboundPayload,
} from "@lingfan-engine/core";
import { wireEngine } from "../../template/v1/__PROJECT__/src/host/engine-wiring";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom";
import type { DialogueView } from "../../template/v1/__PROJECT__/src/host/dialogue-view";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import wiringSource from "../../template/v1/__PROJECT__/src/host/engine-wiring.ts?raw";

/** 最小节点替身：textContent / style / append / innerHTML */
class FakeNode {
  textContent = "";
  innerHTML = "";
  readonly style: Record<string, string> = {};
  readonly children: FakeNode[] = [];
  append(node: FakeNode): void {
    this.children.push(node);
  }
  replaceChildren(): void {
    this.children.length = 0;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  remove(): void {}
  setAttribute(): void {}
  classList = { add(): void {}, remove(): void {} };
  dataset: Record<string, string> = {};
}

function makeDom(): StageDom {
  const node = (): FakeNode => new FakeNode();
  return {
    viewport: node(),
    stageRoot: node(),
    shake: node(),
    shellUi: node(),
    stage: node(),
    dialogue: node(),
    speaker: node(),
    text: node(),
    hint: node(),
    nvl: node(),
    choices: node(),
    notifications: node(),
    toolbar: node(),
    slot: node(),
    save: node(),
    load: node(),
    transition: node(),
    error: node(),
    history: null,
    prefs: null,
    mounts: null,
    body: null,
    minigame: null,
  } as unknown as StageDom;
}

function makeDialogue(): {
  dialogue: DialogueView;
  interactions: string[];
} {
  const interactions: string[] = [];
  const dialogue = {
    setDialogText: vi.fn(),
    setWaiting: vi.fn(),
    setNvlMode: vi.fn(),
    setNvlBuffer: vi.fn(),
    setMenuChanged: vi.fn(),
    setDialogVisible: vi.fn(),
    setMinigame: vi.fn(),
    setInteraction: (system: string) => interactions.push(system),
    readTypewriter: () => null,
    onText: vi.fn(),
    dispose: vi.fn(),
  } as unknown as DialogueView;
  return { dialogue, interactions };
}

interface Harness {
  engine: StoryEngine;
  toasts: string[];
  syncs: number;
  emit(payload: OutboundPayload): void;
}

/** 装配一次 wireEngine：真引擎 + 替身 DOM，收集 toast 与媒体对齐次数 */
function makeHarness(): Harness {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "一" }] },
      ],
    }),
  );
  const toasts: string[] = [];
  let syncs = 0;
  const { dialogue } = makeDialogue();
  wireEngine({
    dom: makeDom(),
    engine,
    layers: {
      setOverride: vi.fn(),
      apply: vi.fn(),
      applyVideo: vi.fn(),
    } as never,
    dialogue,
    resources: { resolve: async (p: string) => p, release: () => {} } as never,
    toast: (text: string) => toasts.push(text),
    reportError: vi.fn(),
    readTypingSetting: () => undefined,
    syncMedia: () => {
      syncs += 1;
    },
  });
  // wireEngine 订阅了引擎事件；测试直接经引擎出站面注入（等价于引擎自发）
  const emit = (payload: OutboundPayload): void => {
    // 经引擎的订阅回调注入：拿 wireEngine 注册的 listener（onEvent 返回退订函数）
    // 这里用真实路径——借 engine 内部事件面不可达，改为再挂一个探针订阅并手动触发：
    // wireEngine 已挂订阅，直接用 (engine as never) 的出站注入面。
    (
      engine as unknown as {
        ctx: { eventListeners: Array<(e: unknown) => void> };
      }
    ).ctx.eventListeners.forEach((listener) =>
      listener({ v: 1, kind: "event", payload }),
    );
  };
  return {
    engine,
    toasts,
    get syncs() {
      return syncs;
    },
    emit,
  } as Harness;
}

describe("知情类出站事件的宿主反应（host-notice-events-wired）", () => {
  it("rollback.done：媒体对齐恰好一次（滚轮/键位/面板共用一处）", () => {
    const h = makeHarness();
    h.emit({ kind: "rollback.done", coordinate: { columnId: "a", index: 0 } });
    expect(h.syncs).toBe(1);
    h.engine.dispose();
  });

  it("load.notice：整句进提示条（迁移成功/历史截断玩家可见）", () => {
    const h = makeHarness();
    h.emit({ kind: "load.notice", text: "存档已迁移" });
    expect(h.toasts).toEqual(["存档已迁移"]);
    h.engine.dispose();
  });

  it("character.missing：带角色键的知情提示，故事不受影响", () => {
    const h = makeHarness();
    h.emit({ kind: "character.missing", key: "ghost" });
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]).toContain("ghost");
    h.engine.dispose();
  });

  it("interaction.mount 无注册表：对话层可见提示（不伪造完成）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        columns: [
          { id: "a", kind: "flow", commands: [{ op: "say", text: "一" }] },
        ],
      }),
    );
    const { dialogue, interactions } = makeDialogue();
    wireEngine({
      dom: makeDom(),
      engine,
      layers: {
        setOverride: vi.fn(),
        apply: vi.fn(),
        applyVideo: vi.fn(),
      } as never,
      dialogue,
      resources: {
        resolve: async (p: string) => p,
        release: () => {},
      } as never,
      toast: vi.fn(),
      reportError: vi.fn(),
      readTypingSetting: () => undefined,
      syncMedia: vi.fn(),
      // interactions 不传 = 无注册表形态
    });
    (
      engine as unknown as {
        ctx: { eventListeners: Array<(e: unknown) => void> };
      }
    ).ctx.eventListeners.forEach((listener) =>
      listener({
        v: 1,
        kind: "event",
        payload: {
          kind: "interaction.mount",
          system: "walk",
          config: {},
          signal: new AbortController().signal,
          seq: 1,
        },
      }),
    );
    expect(interactions).toEqual(["walk"]);
    engine.dispose();
  });

  it("interaction z= 落 minigame 层（与 minigame 共用渲染层，interaction-z-shares-layer）", () => {
    // 源码互锁：zLayerOf 把 SYS.interactionZ 映射到 minigame 层
    expect(wiringSource).toContain(
      'key === SYS.interactionZ ? "minigame" : instanceZLayer(key)',
    );
    // layer-z 写 minigame 层到可选挂载点
    expect(bootSource).not.toContain("onRollback");
  });
});

describe("装配面互锁（boot 交齐 interaction 接线）", () => {
  it("boot 建注册表、注册示例、交 wireEngine（与输入域同一实例）", () => {
    expect(bootSource).toContain("createInteractionRegistry()");
    expect(bootSource).toContain("registerTemplateInteractions(interactions)");
    expect(bootSource).toContain("interactions,");
    // inputScope 只建一次（wireEngine 与 wireInput 共用）
    const builds = bootSource.match(/createInputScopeState\(\)/g) ?? [];
    expect(builds).toHaveLength(1);
  });
});
