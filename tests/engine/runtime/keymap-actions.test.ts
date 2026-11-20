/**
 * 键位契约扩展（M03）：7 动作只增、组合键串降级、单动作封顶、读面 override ?? 默认。
 *
 * PlayerKeymap 只增 rollback/quickSave/quickLoad/skip/hideUI；KEYMAP_ACTIONS 扩 7；
 * sanitizeKeymap 遍历 KEYMAP_ACTIONS 逐项降级（非法剔、去重小写、封顶 8），不补默认键。
 *
 * 证伪锚：KEYMAP_ACTIONS 漏新动作 / sanitize 补默认键，本册对应例转红。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData, PreferencesPort } from "@lingfan-engine/core";
import {
  DEFAULT_KEYMAP,
  KEYMAP_ACTIONS,
  PlayerPreferences,
} from "@lingfan-engine/core";

class MemoryPrefsPort implements PreferencesPort {
  constructor(private data: unknown) {}
  async load(): Promise<PlayerPrefsData | null> {
    return this.data as PlayerPrefsData | null;
  }
  async save(): Promise<void> {}
}

async function hydrate(raw: unknown) {
  const prefs = new PlayerPreferences(new MemoryPrefsPort(raw));
  await prefs.hydrate();
  return prefs;
}

describe("键位契约 7 动作（只增不改）", () => {
  it("KEYMAP_ACTIONS 含全部 7 动作", () => {
    expect([...KEYMAP_ACTIONS]).toEqual([
      "advance",
      "history",
      "rollback",
      "quickSave",
      "quickLoad",
      "skip",
      "hideUI",
    ]);
  });

  it("DEFAULT_KEYMAP 七键齐全（Required 强制）", () => {
    expect(DEFAULT_KEYMAP.advance).toEqual([" ", "Enter"]);
    expect(DEFAULT_KEYMAP.history).toEqual(["h"]);
    expect(DEFAULT_KEYMAP.quickSave).toEqual(["ctrl+s", "meta+s"]);
    expect(DEFAULT_KEYMAP.quickLoad).toEqual(["ctrl+l", "meta+l"]);
    expect(DEFAULT_KEYMAP.skip).toEqual(["Control"]);
    expect(Array.isArray(DEFAULT_KEYMAP.rollback)).toBe(true);
    expect(Array.isArray(DEFAULT_KEYMAP.hideUI)).toBe(true);
  });

  it("空载荷不补默认键位键（三态）", async () => {
    const prefs = await hydrate({ v: 1 });
    expect(prefs.snapshot().keymap).toBeUndefined();
  });

  it("7 动作合法键位原样保留（含组合键串）", async () => {
    const prefs = await hydrate({
      v: 1,
      keymap: {
        advance: [" "],
        history: ["h"],
        rollback: ["ctrl+z"],
        quickSave: ["ctrl+s"],
        quickLoad: ["ctrl+l"],
        skip: ["Control"],
        hideUI: ["ctrl+h"],
      },
    });
    const keymap = prefs.snapshot().keymap;
    expect(keymap?.rollback).toEqual(["ctrl+z"]);
    expect(keymap?.skip).toEqual(["Control"]);
    expect(keymap?.hideUI).toEqual(["ctrl+h"]);
  });

  it("逐项降级：非法剔、去重小写、单动作封顶 8", async () => {
    const prefs = await hydrate({
      v: 1,
      keymap: {
        advance: ["a", "A", " ", "", 42, "b", "c", "d", "e", "f", "g", "h"],
        skip: "not-array",
      } as never,
    });
    const keymap = prefs.snapshot().keymap;
    // 空白键 trim 后为空被剔（" "→""）；a/A 去重小写；封顶 8
    expect(keymap?.advance).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(keymap?.skip).toBeUndefined();
  });

  it("读面 keybinding：覆盖原样、未设置 undefined（匹配时 ?? 默认）", async () => {
    const prefs = await hydrate({
      v: 1,
      keymap: { quickSave: ["ctrl+shift+s"] },
    });
    expect(prefs.keybinding("quickSave")).toEqual(["ctrl+shift+s"]);
    expect(prefs.keybinding("advance")).toBeUndefined();
  });
});
