/**
 * 宿主命名命令注册表测试（fail-closed 注册制，与 minigame / 元素渲染器注册表同纪律）。
 */
import { describe, expect, it } from "vitest";
import type { ElementInstance } from "@lingfan/engine";
import { createCommandRegistry } from "@lingfan/ui";

function element(
  id: string,
  props: Record<string, unknown> = {},
): ElementInstance {
  return { id, type: "button", props, z: 0, children: [] };
}

describe("CommandRegistry（fail-closed）", () => {
  it("未注册 → undefined（不伪造默认处理器）", () => {
    const registry = createCommandRegistry();
    expect(registry.has("openPrefs")).toBe(false);
    expect(registry.get("openPrefs")).toBeUndefined();
    expect(registry.names()).toEqual([]);
  });

  it("注册 / 覆盖 / 列举", () => {
    const registry = createCommandRegistry();
    const first = (): void => {};
    const second = (): void => {};
    registry.register("openPrefs", first);
    expect(registry.get("openPrefs")).toBe(first);
    expect(registry.names()).toEqual(["openPrefs"]);
    registry.register("openPrefs", second); // 同名再注册 = 替换
    expect(registry.get("openPrefs")).toBe(second);
  });

  it("处理器收到（已求值 value, 来源元素）", () => {
    const registry = createCommandRegistry();
    const seen: Array<[string | undefined, ElementInstance]> = [];
    registry.register("jump", (value, source) => {
      seen.push([value, source]);
    });
    const el = element("btn", { cmd: "jump", value: "chapter-2" });
    registry.get("jump")!("chapter-2", el);
    expect(seen).toEqual([["chapter-2", el]]);
  });
});
