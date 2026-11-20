/**
 * 对话框外观偏好 → CSS 变量投影测试。
 *
 * 三态纪律：透明度/高度/位置未设置时移除变量/属性（宿主样式回退内建外观），字号倍率
 * 恒投影（缺省 1）。偏好改动经 onChange 即时重投（滑杆 live），退订后不再投影。
 * 五类覆盖：多方位（四字段各自投影）、拟态旅程（调滑杆即时重投）、故意错误（clear 回退）、
 * 不变量（缺省 ≠ 显式：未设置绝不写默认值进变量）、边界（退订）。
 */
import { describe, expect, it } from "vitest";
import { PlayerPreferences } from "@lingfan-engine/core";
import {
  DIALOGUE_FONT_SCALE_VAR,
  DIALOGUE_HEIGHT_SCALE_VAR,
  DIALOGUE_OPACITY_VAR,
  DIALOGUE_POSITION_ATTR,
  applyDialogueAppearance,
} from "@lingfan-engine/ui";

/** 最小 DOM 替身：style 变量 + data 属性，够投影读断言 */
function fakeElement() {
  const vars = new Map<string, string>();
  const attrs = new Map<string, string>();
  const el = {
    style: {
      setProperty: (name: string, value: string) => vars.set(name, value),
      removeProperty: (name: string) => vars.delete(name),
      getPropertyValue: (name: string) => vars.get(name) ?? "",
    },
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    removeAttribute: (name: string) => attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
  return { el: el as unknown as HTMLElement, vars, attrs };
}

describe("装配即投影：字号恒有值，三态未设置不写变量", () => {
  it("缺省偏好：fontScale=1 投影，opacity/height/position 缺席", () => {
    const { el, vars, attrs } = fakeElement();
    const prefs = new PlayerPreferences();
    applyDialogueAppearance(el, prefs);
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("1");
    expect(vars.has(DIALOGUE_OPACITY_VAR)).toBe(false);
    expect(vars.has(DIALOGUE_HEIGHT_SCALE_VAR)).toBe(false);
    expect(attrs.has(DIALOGUE_POSITION_ATTR)).toBe(false);
  });
});

describe("显式设置 → 投影；clear → 移除回退", () => {
  it("设置四字段后变量/属性就位", () => {
    const { el, vars, attrs } = fakeElement();
    const prefs = new PlayerPreferences();
    applyDialogueAppearance(el, prefs);
    prefs.setDialogueOpacity(0.5);
    prefs.setFontScale(1.5);
    prefs.setDialogueHeightScale(1.2);
    prefs.setDialoguePosition("top");
    expect(vars.get(DIALOGUE_OPACITY_VAR)).toBe("0.5");
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("1.5");
    expect(vars.get(DIALOGUE_HEIGHT_SCALE_VAR)).toBe("1.2");
    expect(attrs.get(DIALOGUE_POSITION_ATTR)).toBe("top");
  });

  it("clear 三态字段 → 变量/属性移除（回退内建外观）", () => {
    const { el, vars, attrs } = fakeElement();
    const prefs = new PlayerPreferences();
    prefs.setDialogueOpacity(0.5);
    prefs.setDialogueHeightScale(1.2);
    prefs.setDialoguePosition("center");
    applyDialogueAppearance(el, prefs);
    expect(vars.has(DIALOGUE_OPACITY_VAR)).toBe(true);
    prefs.clearDialogueOpacity();
    prefs.clearDialogueHeightScale();
    prefs.clearDialoguePosition();
    expect(vars.has(DIALOGUE_OPACITY_VAR)).toBe(false);
    expect(vars.has(DIALOGUE_HEIGHT_SCALE_VAR)).toBe(false);
    expect(attrs.has(DIALOGUE_POSITION_ATTR)).toBe(false);
    // 字号仍恒投影
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("1");
  });
});

describe("拟态旅程：偏好改动即时重投（onChange live）", () => {
  it("装配后调滑杆，变量随动", () => {
    const { el, vars } = fakeElement();
    const prefs = new PlayerPreferences();
    applyDialogueAppearance(el, prefs);
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("1");
    prefs.setFontScale(2);
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("2");
    prefs.setDialogueOpacity(0.3);
    expect(vars.get(DIALOGUE_OPACITY_VAR)).toBe("0.3");
  });

  it("退订后不再投影", () => {
    const { el, vars } = fakeElement();
    const prefs = new PlayerPreferences();
    const stop = applyDialogueAppearance(el, prefs);
    stop();
    prefs.setFontScale(2.5);
    expect(vars.get(DIALOGUE_FONT_SCALE_VAR)).toBe("1");
  });
});
