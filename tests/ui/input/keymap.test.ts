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
