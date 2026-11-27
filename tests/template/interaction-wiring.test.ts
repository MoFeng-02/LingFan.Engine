/**
 * 玩法系统接管的模板接线旅程：注册表 → 挂载分支 → 真引擎全链。
 *
 * 与小游戏旅程（mount-consumption）同构，但多验三件 interaction 独有的事：
 * - **输入域交接**：接管切 world（推进/回溯键让位）、收尾交还 dialogue——两条结束
 *   路径（正常回填 / 中断）都必须交还，漏一条 = 叙事键永久失效。
 * - **状态即接口**：工厂经 writer 写 `game.<system>.*`，随快照/存档/回溯随行。
 * - **fail-closed**：未注册系统 / 无挂载点都显式出声，不伪造完成。
 *
 * DOM 用最小替身（与 mount-consumption 同口径），引擎用真的。
 */
import { describe, expect, it, vi } from "vitest";
import {
  StoryEngine,
  SYS,
  parseStory,
  type InteractionResult,
  type OutboundEvent,
} from "@lingfan-engine/core";
import { createInputScopeState } from "@lingfan-engine/ui";
import {
  createInteractionRegistry,
  demoInteraction,
  registerTemplateInteractions,
} from "../../template/v1/__PROJECT__/src/host/interaction-demo";
import { handleInteractionMount } from "../../template/v1/__PROJECT__/src/host/interaction-mount";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 最小挂载点替身：append / innerHTML / 按钮点击 */
class FakeHost {
  innerHTML = "";
  readonly buttons: Array<{ click(): void }> = [];
  append(node: { click(): void }): void {
    this.buttons.push(node);
  }
}

/** 造真引擎：一列 interaction + 成功/失败两个分流落点 */
function makeEngine(): { engine: StoryEngine; events: OutboundEvent[] } {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "s",
          kind: "flow",
          commands: [
            {
              op: "interaction",
              system: "demo",
              on_success: "ok",
              on_fail: "ng",
            },
          ],
        },
        { id: "ok", kind: "flow", commands: [{ op: "say", text: "成功分支" }] },
        { id: "ng", kind: "flow", commands: [{ op: "say", text: "失败分支" }] },
      ],
    }),
  );
  const events: OutboundEvent[] = [];
  engine.onEvent((e) => events.push(e));
  engine.start();
  return { engine, events };
}

function mountOf(events: OutboundEvent[]) {
  const hit = events.find((e) => e.payload.kind === "interaction.mount");
  return hit?.payload.kind === "interaction.mount" ? hit.payload : undefined;
}

describe("玩法系统经注册表真挂载（interaction-mounts-registry）", () => {
  it("脚手架注册表就位（demo 可解析）", () => {
    const registry = createInteractionRegistry();
    registerTemplateInteractions(registry);
    expect(registry.has("demo")).toBe(true);
    expect(registry.get("demo")).toBe(demoInteraction);
  });

  it("已注册：工厂跑完回填结果，域交还叙事（interaction-scope-handback）", async () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const scope = createInputScopeState();
    const host = new FakeHost();
    const errors: string[] = [];
    handleInteractionMount(payload, {
      interactions: (() => {
        const r = createInteractionRegistry();
        r.register("demo", () => Promise.resolve({ outcome: "success" }));
        return r;
      })(),
      readHost: () => host as unknown as HTMLElement,
      inInteraction: { value: false },
      inputScope: scope,
      error: {
        get value() {
          return "";
        },
        set value(m: string) {
          errors.push(m);
        },
      },
      resolveInteraction: (system, result) =>
        engine.resolveInteraction(system, result),
      writer: engine.gameState,
    });
    expect(scope.current()).toBe("world"); // 接管期叙事键让位
    await flush();
    expect(errors).toEqual([]);
    expect(scope.current()).toBe("dialogue"); // 收尾交还
    expect(engine.get(SYS.waiting)).not.toBe("interaction");
    expect(engine.get(SYS.currentDialogText)).toBe("成功分支");
    engine.dispose();
  });

  it("中断（回溯）：abort 收尾也交还域，不回填结果（interaction-abort-handback）", async () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const scope = createInputScopeState();
    const host = new FakeHost();
    let pending: ((r: InteractionResult) => void) | undefined;
    const registry = createInteractionRegistry();
    registry.register(
      "demo",
      () =>
        new Promise<InteractionResult>((resolve) => {
          pending = resolve;
        }),
    );
    const resolved: InteractionResult[] = [];
    handleInteractionMount(payload, {
      interactions: registry,
      readHost: () => host as unknown as HTMLElement,
      inInteraction: { value: false },
      inputScope: scope,
      error: { value: "" },
      resolveInteraction: (_s, r) => resolved.push(r),
      writer: engine.gameState,
    });
    expect(scope.current()).toBe("world");
    // 引擎中断接管（读档/导航同口径）：signal 置位 → 分支收尾
    engine.navigate("ok");
    await flush();
    expect(scope.current()).toBe("dialogue");
    expect(host.innerHTML).toBe("");
    // 中断后工厂迟到回填：结果必须被丢弃
    pending?.({ outcome: "success" });
    await flush();
    expect(resolved).toEqual([]);
    engine.dispose();
  });

  it("未注册系统：fail-closed 出声，等待保持不伪造完成（interaction-unregistered-fail-closed）", () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const errors: string[] = [];
    handleInteractionMount(payload, {
      interactions: createInteractionRegistry(), // 空表
      readHost: () => new FakeHost() as unknown as HTMLElement,
      inInteraction: { value: false },
      error: {
        get value() {
          return "";
        },
        set value(m: string) {
          errors.push(m);
        },
      },
      resolveInteraction: () => {
        throw new Error("不得回填");
      },
      writer: engine.gameState,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("demo");
    expect(engine.get(SYS.waiting)).toBe("interaction"); // 等待保持
    engine.dispose();
  });

  it("无挂载点：显式诊断而非静默返回（interaction-no-host-diagnosed）", () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const registry = createInteractionRegistry();
    registry.register("demo", () => Promise.resolve({ outcome: "success" }));
    const errors: string[] = [];
    handleInteractionMount(payload, {
      interactions: registry,
      readHost: () => null,
      inInteraction: { value: false },
      error: {
        get value() {
          return "";
        },
        set value(m: string) {
          errors.push(m);
        },
      },
      resolveInteraction: () => {
        throw new Error("不得回填");
      },
      writer: engine.gameState,
    });
    expect(errors).toHaveLength(1);
    expect(engine.get(SYS.waiting)).toBe("interaction");
    engine.dispose();
  });

  it("状态即接口：工厂经 writer 写 game.demo.*，回溯随行（interaction-state-snapshot）", async () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const registry = createInteractionRegistry();
    registry.register("demo", (_host, ctx) => {
      ctx.writer.setScoped("demo", "visited", true);
      return Promise.resolve({ outcome: "success", state: { cleared: true } });
    });
    handleInteractionMount(payload, {
      interactions: registry,
      readHost: () => new FakeHost() as unknown as HTMLElement,
      inInteraction: { value: false },
      error: { value: "" },
      resolveInteraction: (s, r) => engine.resolveInteraction(s, r),
      writer: engine.gameState,
    });
    await flush();
    expect(engine.get("game.demo.visited")).toBe(true);
    expect(engine.get("game.demo.cleared")).toBe(true);
    engine.dispose();
  });

  it("工厂异常：错误出声并收尾，不悬挂等待面（interaction-factory-error-handled）", async () => {
    const { engine, events } = makeEngine();
    const payload = mountOf(events)!;
    const registry = createInteractionRegistry();
    registry.register("demo", () => Promise.reject(new Error("炸")));
    const scope = createInputScopeState();
    const errors: string[] = [];
    handleInteractionMount(payload, {
      interactions: registry,
      readHost: () => new FakeHost() as unknown as HTMLElement,
      inInteraction: { value: false },
      inputScope: scope,
      error: {
        get value() {
          return "";
        },
        set value(m: string) {
          errors.push(m);
        },
      },
      resolveInteraction: vi.fn(),
      writer: engine.gameState,
    });
    await flush();
    expect(errors.some((m) => m.includes("玩法系统异常"))).toBe(true);
    expect(scope.current()).toBe("dialogue");
    engine.dispose();
  });
});
