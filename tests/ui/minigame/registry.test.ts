/**
 * 06 §二/D5 MinigameRegistry 测试：注册/覆盖更新/未知 fail-closed（无默认回退——
 * 与对话框模板注册表「未知名回退默认」的关键差异）。
 * 锚点: minigame-fail-closed-and-abortable
 */
import { describe, expect, it } from "vitest";
import type { MinigameFactory } from "@lingfan/engine";
import { createMinigameRegistry } from "@lingfan/ui";

const factory: MinigameFactory = async () => ({ outcome: "success" });

describe("MinigameRegistry（fail-closed 注册制）", () => {
  it("注册后可解析；未注册返回 undefined（不伪造默认）", () => {
    const registry = createMinigameRegistry();
    expect(registry.has("puzzle")).toBe(false);
    expect(registry.get("puzzle")).toBeUndefined();
    registry.register("puzzle", factory);
    expect(registry.has("puzzle")).toBe(true);
    expect(registry.get("puzzle")).toBe(factory);
  });

  it("同 gameId 再注册 = 覆盖更新（开发热替换语义）", () => {
    const registry = createMinigameRegistry();
    const second: MinigameFactory = async () => ({ outcome: "fail" });
    registry.register("puzzle", factory);
    registry.register("puzzle", second);
    expect(registry.get("puzzle")).toBe(second);
  });

  it("解析出的工厂可被宿主调用并回填结果（契约冒烟，node 环境以替身充当宿主元素）", async () => {
    const registry = createMinigameRegistry();
    let mountedHost: HTMLElement | undefined;
    registry.register("counter", async (host, ctx) => {
      mountedHost = host;
      expect(ctx.config).toEqual({ target: 3 });
      expect(ctx.signal.aborted).toBe(false);
      return { outcome: "success", score: ctx.config.target as number };
    });
    const host = { mounted: true } as unknown as HTMLElement;
    const result = await registry.get("counter")!(host, {
      config: { target: 3 },
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ outcome: "success", score: 3 });
    expect(mountedHost).toBe(host);
  });
});
