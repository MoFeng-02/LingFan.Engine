/**
 * 回退控制面的宿主接线旅程：作者级历史容量 + 滚轮回退守卫。
 *
 * 两条纪律各用一种手法锁：
 * - **作者级 historyLimit**：组合根不再硬编码 200，改读工程声明（`resolveHistoryLimit(manifest)`），
 *   用源文本断言锁接线（`tests/template` 前端域禁 Node 导入，组合根整体 boot 不便真跑）。
 * - **滚轮回退守卫**：真接 `wireInput`，引擎替身的 `rollbackAvailable()` 可变——
 *   工程关闭回退 / op 级锁定时滚轮不再调 back/forward，读的是引擎唯一读面而非宿主自算。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SYS } from "@lingfan-engine/core";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import { wireInput } from "../../template/v1/__PROJECT__/src/host/input-map";
import type { StageDom } from "../../template/v1/__PROJECT__/src/host/stage-dom";
import type { DialogueView } from "../../template/v1/__PROJECT__/src/host/dialogue-view";

type Handler = (event: Record<string, unknown>) => void;

class FakeElement {
  readonly listeners = new Map<string, Set<Handler>>();
  parent: FakeElement | null = null;

  addEventListener(
    type: string,
    handler: Handler,
    options?: { signal?: AbortSignal },
  ): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    options?.signal?.addEventListener("abort", () => set.delete(handler));
  }

  fire(type: string, event: Record<string, unknown> = {}): void {
    const enriched: Record<string, unknown> = {
      target: this,
      ...event,
      stopPropagation(): void {
        enriched._stopped = true;
      },
      preventDefault(): void {
        enriched._prevented = true;
      },
    };
    for (const handler of this.listeners.get(type) ?? []) handler(enriched);
    if (enriched._stopped !== true && this.parent !== null)
      this.parent.fire(type, enriched);
  }
}

const documentListeners = new Map<string, Set<Handler>>();

function stubDocument(): void {
  vi.stubGlobal("document", {
    addEventListener(
      type: string,
      handler: Handler,
      options?: { signal?: AbortSignal },
    ): void {
      let set = documentListeners.get(type);
      if (set === undefined) {
        set = new Set();
        documentListeners.set(type, set);
      }
      set.add(handler);
      options?.signal?.addEventListener("abort", () => set.delete(handler));
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  documentListeners.clear();
});

describe("作者级历史容量接线", () => {
  it("组合根读工程 shell.historyLimit，不再硬编码 200", () => {
    expect(bootSource).toContain("resolveHistoryLimit(manifest)");
    expect(bootSource).not.toContain("historyLimit: 200");
  });

  it("resolveHistoryLimit 从核心包导入（单一事实源）", () => {
    expect(bootSource).toMatch(
      /resolveHistoryLimit[\s\S]*?from "@lingfan-engine\/core"/,
    );
  });
});

describe("滚轮回退守卫（读引擎唯一读面）", () => {
  function wheelHarness(available: () => boolean) {
    stubDocument();
    const back = vi.fn();
    const forward = vi.fn();
    const engine = {
      get: (key: string) => (key === SYS.waiting ? "dialog" : undefined),
      advance: vi.fn(),
      back,
      forward,
      rollbackAvailable: available,
    };
    const dialogue = { readTypewriter: () => null } as unknown as DialogueView;
    const viewport = new FakeElement();
    const choices = new FakeElement();
    const toolbar = new FakeElement();
    const notifications = new FakeElement();
    choices.parent = viewport;
    toolbar.parent = viewport;
    notifications.parent = viewport;
    const dom = {
      viewport,
      choices,
      toolbar,
      notifications,
    } as unknown as StageDom;
    wireInput({ dom, engine: engine as never, dialogue });
    return { viewport, back, forward };
  }

  it("可回退时滚轮上滚回退、下滚前进", () => {
    const h = wheelHarness(() => true);
    h.viewport.fire("wheel", { deltaY: -1 });
    expect(h.back).toHaveBeenCalledTimes(1);
    h.viewport.fire("wheel", { deltaY: 1 });
    expect(h.forward).toHaveBeenCalledTimes(1);
  });

  it("工程关闭回退 / op 级锁定时滚轮不回退（rollbackAvailable=false）", () => {
    const h = wheelHarness(() => false);
    h.viewport.fire("wheel", { deltaY: -1 });
    h.viewport.fire("wheel", { deltaY: 1 });
    expect(h.back).not.toHaveBeenCalled();
    expect(h.forward).not.toHaveBeenCalled();
  });

  it("锁定解除后滚轮恢复回退", () => {
    let available = false;
    const h = wheelHarness(() => available);
    h.viewport.fire("wheel", { deltaY: -1 });
    expect(h.back).not.toHaveBeenCalled();
    available = true;
    h.viewport.fire("wheel", { deltaY: -1 });
    expect(h.back).toHaveBeenCalledTimes(1);
  });
});
