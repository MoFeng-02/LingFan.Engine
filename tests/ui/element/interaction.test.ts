/**
 * 点击动作解析测试。
 *
 * 优先级：`disabled` > `nav` > `ops` > `cmd`
 * （`hover_*` / `selected_*` / `disabled_*` 为与点击正交的视觉态）。
 */
import { describe, expect, it } from "vitest";
import {
  hasElementInteraction,
  isElementDisabled,
  resolveElementAction,
} from "@lingfan/ui";

describe("resolveElementAction（点击优先级）", () => {
  it("disabled 短路：不产生任何动作（最高优先级）", () => {
    expect(resolveElementAction({ disabled: true, nav: "a", cmd: "b" })).toEqual({
      kind: "disabled",
    });
    expect(resolveElementAction({ enabled: false, nav: "a" })).toEqual({
      kind: "disabled",
    });
  });

  it("nav 优先于 ops 与 cmd", () => {
    expect(
      resolveElementAction({
        nav: "scene2",
        ops: [{ op: "set", key: "a", value: 1 }],
        cmd: "openPrefs",
      }),
    ).toEqual({ kind: "nav", target: "scene2" });
  });

  it("ops 优先于 cmd（数据侧动作先于宿主命令）", () => {
    const ops = [{ op: "set", key: "a", value: 1 }];
    expect(resolveElementAction({ ops, cmd: "openPrefs" })).toEqual({
      kind: "ops",
      ops,
    });
  });

  it("ops 原样透传（表达式由引擎在点击时刻求值）", () => {
    const ops = [
      { op: "set", key: "player.gold", value: "+= {10}" },
      { op: "se", resource: "Audio/coin.mp3" },
    ];
    expect(resolveElementAction({ ops })).toEqual({ kind: "ops", ops });
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

  it("空串视为未设置；皆无 → none", () => {
    expect(resolveElementAction({ nav: "" })).toEqual({ kind: "none" });
    expect(resolveElementAction({ cmd: "" })).toEqual({ kind: "none" });
    expect(resolveElementAction({ nav: "", cmd: "a" })).toEqual({
      kind: "cmd",
      name: "a",
    });
    expect(resolveElementAction({ text: "纯展示" })).toEqual({ kind: "none" });
  });

  it("畸形 ops 负载不当作声明（回落 cmd / none）", () => {
    // 空数组 / 非数组 / 元素非对象 / 缺 op / op 非字符串 —— 一律视为未声明
    expect(resolveElementAction({ ops: [] })).toEqual({ kind: "none" });
    expect(resolveElementAction({ ops: "not-array" })).toEqual({
      kind: "none",
    });
    expect(resolveElementAction({ ops: [1, 2] })).toEqual({ kind: "none" });
    expect(resolveElementAction({ ops: [{ key: "a" }] })).toEqual({
      kind: "none",
    });
    expect(resolveElementAction({ ops: [{ op: 42 }] })).toEqual({
      kind: "none",
    });
    expect(resolveElementAction({ ops: [{ op: "" }] })).toEqual({
      kind: "none",
    });
    // 畸形 ops + 合法 cmd = 走 cmd（畸形不吞掉合法声明）
    expect(resolveElementAction({ ops: [], cmd: "x" })).toEqual({
      kind: "cmd",
      name: "x",
    });
  });

  it("hasElementInteraction 与动作解析同源", () => {
    expect(hasElementInteraction({ nav: "a" })).toBe(true);
    expect(hasElementInteraction({ cmd: "a" })).toBe(true);
    expect(hasElementInteraction({ ops: [{ op: "set" }] })).toBe(true);
    expect(hasElementInteraction({ disabled: true, nav: "a" })).toBe(false);
    expect(hasElementInteraction({ text: "纯展示" })).toBe(false);
  });
});

describe("isElementDisabled（禁用判定，含表达式形态）", () => {
  it("布尔形态与 enabled=false 同义", () => {
    expect(isElementDisabled({ disabled: true })).toBe(true);
    expect(isElementDisabled({ enabled: false })).toBe(true);
    expect(isElementDisabled({ disabled: false })).toBe(false);
    expect(isElementDisabled({})).toBe(false);
  });

  it("表达式形态经求值器判定（UI 层不解析表达式语法）", () => {
    const props = { disabled: "{player.gold < 10}" };
    expect(isElementDisabled(props, { evalDisable: () => true })).toBe(true);
    expect(isElementDisabled(props, { evalDisable: () => false })).toBe(false);
    // 求值器收到原始表达式（含花括号，由核心层插值）
    let seen = "";
    isElementDisabled(props, {
      evalDisable: (e) => {
        seen = e;
        return null;
      },
    });
    expect(seen).toBe("{player.gold < 10}");
  });

  it("求值失败（null）= 不禁用：宁可点得动（禁用误判会锁死交互）", () => {
    expect(
      isElementDisabled({ disabled: "{坏表达式" }, { evalDisable: () => null }),
    ).toBe(false);
  });

  it("无求值器时字符串形态不擅自禁用", () => {
    expect(isElementDisabled({ disabled: "{x}" })).toBe(false);
    // enabled=false 是布尔语义，仍优先生效
    expect(isElementDisabled({ enabled: false, disabled: "{x}" })).toBe(true);
  });

  it("字符串形态下 disabled 仍优先于任何点击动作", () => {
    expect(
      resolveElementAction(
        { disabled: "{cond}", nav: "a" },
        { evalDisable: () => true },
      ),
    ).toEqual({ kind: "disabled" });
  });
});
