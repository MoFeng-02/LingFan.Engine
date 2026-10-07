/**
 * 点击动作解析测试。
 *
 * 优先级对照既有实现 InteractionBinder.ApplyInteraction 的行为：
 * `disabled` > `nav` > `cmd` > `hover_*` > `selected_*`（后两级为与点击正交的视觉态）。
 */
import { describe, expect, it } from "vitest";
import { hasElementInteraction, resolveElementAction } from "@lingfan/ui";

describe("resolveElementAction（点击优先级）", () => {
  it("disabled 短路：不产生任何动作（最高优先级）", () => {
    expect(resolveElementAction({ disabled: true, nav: "a", cmd: "b" })).toEqual({
      kind: "none",
    });
    expect(resolveElementAction({ enabled: false, nav: "a" })).toEqual({
      kind: "none",
    });
  });

  it("nav 优先于 cmd", () => {
    expect(
      resolveElementAction({ nav: "scene2", cmd: "openPrefs" }),
    ).toEqual({ kind: "nav", target: "scene2" });
  });

  it("无 nav 时走 cmd；value 原文透传（宿主按点击时刻插值）", () => {
    expect(
      resolveElementAction({ cmd: "openPrefs", value: "{player.gold}" }),
    ).toEqual({ kind: "cmd", name: "openPrefs", value: "{player.gold}" });
    expect(resolveElementAction({ cmd: "x" })).toEqual({
      kind: "cmd",
      name: "x",
    });
  });

  it("空串视为未设置；两者皆无 → none", () => {
    expect(resolveElementAction({ nav: "" })).toEqual({ kind: "none" });
    expect(resolveElementAction({ cmd: "" })).toEqual({ kind: "none" });
    expect(resolveElementAction({ nav: "", cmd: "a" })).toEqual({
      kind: "cmd",
      name: "a",
    });
    expect(resolveElementAction({ text: "纯展示" })).toEqual({ kind: "none" });
  });

  it("hasElementInteraction 与动作解析同源", () => {
    expect(hasElementInteraction({ nav: "a" })).toBe(true);
    expect(hasElementInteraction({ cmd: "a" })).toBe(true);
    expect(hasElementInteraction({ disabled: true, nav: "a" })).toBe(false);
    expect(hasElementInteraction({ text: "纯展示" })).toBe(false);
  });
});
