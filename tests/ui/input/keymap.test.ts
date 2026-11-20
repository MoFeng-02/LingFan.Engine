/**
 * 键位匹配纯函数：override ?? fallback、大小写不敏感、缺席不等于无键。
 * 宿主输入映射与改绑面板共用这一份判定，这里把它的边界钉死。
 */
import { describe, expect, it } from "vitest";
import { matchesKeybinding } from "@lingfan-engine/ui";

describe("matchesKeybinding", () => {
  it("无改绑落回默认键位", () => {
    expect(matchesKeybinding(undefined, [" ", "Enter"], { key: " " })).toBe(
      true,
    );
    expect(matchesKeybinding(undefined, [" ", "Enter"], { key: "Enter" })).toBe(
      true,
    );
    expect(matchesKeybinding(undefined, [" ", "Enter"], { key: "a" })).toBe(
      false,
    );
  });

  it("改绑取代默认（旧默认键不再命中）", () => {
    expect(matchesKeybinding(["a"], [" ", "Enter"], { key: "a" })).toBe(true);
    expect(matchesKeybinding(["a"], [" ", "Enter"], { key: " " })).toBe(false);
  });

  it("大小写不敏感（绑 a 按 A、绑 A 按 a 都命中）", () => {
    expect(matchesKeybinding(["a"], [], { key: "A" })).toBe(true);
    expect(matchesKeybinding(["A"], [], { key: "a" })).toBe(true);
    expect(matchesKeybinding(undefined, ["h"], { key: "H" })).toBe(true);
  });

  it("空改绑表是「这个动作没有键」，不落回默认", () => {
    expect(matchesKeybinding([], [" "], { key: " " })).toBe(false);
  });

  it("多键任一命中即可", () => {
    expect(matchesKeybinding(["a", "b"], [], { key: "b" })).toBe(true);
    expect(matchesKeybinding(["a", "b"], [], { key: "c" })).toBe(false);
  });
});

describe("matchesKeybinding 组合键（[mod+]<key>）", () => {
  it("ctrl+s 命中按住 Ctrl 的 s，不命中裸 s", () => {
    expect(matchesKeybinding(["ctrl+s"], [], { key: "s", ctrlKey: true })).toBe(
      true,
    );
    expect(matchesKeybinding(["ctrl+s"], [], { key: "s" })).toBe(false);
  });

  it("纯键不命中带修饰键的按下（多余修饰键不算）", () => {
    expect(matchesKeybinding(["s"], [], { key: "s", ctrlKey: true })).toBe(
      false,
    );
    expect(matchesKeybinding(["s"], [], { key: "s" })).toBe(true);
  });

  it("组合键大小写不敏感（Ctrl+S / CTRL+s）", () => {
    expect(matchesKeybinding(["Ctrl+S"], [], { key: "S", ctrlKey: true })).toBe(
      true,
    );
    expect(matchesKeybinding(["CTRL+s"], [], { key: "s", ctrlKey: true })).toBe(
      true,
    );
  });

  it("多修饰键须全匹配（shift+alt+a）", () => {
    expect(
      matchesKeybinding(["shift+alt+a"], [], {
        key: "a",
        shiftKey: true,
        altKey: true,
      }),
    ).toBe(true);
    expect(
      matchesKeybinding(["shift+alt+a"], [], { key: "a", shiftKey: true }),
    ).toBe(false);
  });

  it("修饰键本身可作绑定（skip 按住 Control）", () => {
    expect(matchesKeybinding(["Control"], [], { key: "Control" })).toBe(true);
    expect(matchesKeybinding(["Control"], [], { key: "Shift" })).toBe(false);
  });

  it("meta（Cmd）组合键", () => {
    expect(matchesKeybinding(["meta+s"], [], { key: "s", metaKey: true })).toBe(
      true,
    );
    expect(matchesKeybinding(["meta+s"], [], { key: "s", ctrlKey: true })).toBe(
      false,
    );
  });
});
