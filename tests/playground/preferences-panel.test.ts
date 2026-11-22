/**
 * playground 偏好面板句柄测试（host/panels/views/preferences-panel）。
 * - 播放/文本外观写入口（自动播放/自动延时/阅读速度/未读即停/字体/字速源）把 DOM 事件
 *   原样转给核心 setter：面板不自持状态，视图镜像随偏好变更即时刷新
 * - onChanged 与镜像同步触发（宿主「字速即时作用于当前句」的落点信号）
 * - 畸形事件 fail-closed：非法滑杆值/词表外选项被核心忽略，状态原样
 * - dispose 退订：卸载后偏好变更不再刷新镜像（与构造成对）
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUTO_DELAY_MS_RANGE,
  AUTO_READ_CPS_RANGE,
  PlayerPreferences,
} from "@lingfan-engine/core";
import { createPreferencesPanel } from "../../apps/playground/src/host/panels/views/preferences-panel.ts";

/** 最小事件替身：面板只读 target 的控件面（checked/value），不触其余 DOM API */
function checkbox(checked: boolean): Event {
  return { target: { checked } } as unknown as Event;
}
function control(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe("播放偏好写入口", () => {
  it("自动播放开关：事件转核心 setter，镜像即时跟上", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setAutoEnabled(checkbox(true));
    expect(preferences.autoEnabled).toBe(true);
    expect(panel.view.value.autoEnabled).toBe(true);
    panel.setAutoEnabled(checkbox(false));
    expect(preferences.autoEnabled).toBe(false);
    expect(panel.view.value.autoEnabled).toBe(false);
    panel.dispose();
  });

  it("自动延时滑杆：数值采纳、越界钳制；非数值忽略状态原样（fail-closed）", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setAutoDelayMs(control("2500"));
    expect(preferences.autoDelayMs).toBe(2500);
    expect(panel.view.value.autoDelayMs).toBe(2500);
    panel.setAutoDelayMs(control(String(AUTO_DELAY_MS_RANGE.max + 1000)));
    expect(preferences.autoDelayMs).toBe(AUTO_DELAY_MS_RANGE.max);
    panel.setAutoDelayMs(control("not-a-number"));
    expect(preferences.autoDelayMs).toBe(AUTO_DELAY_MS_RANGE.max); // 原样
    panel.dispose();
  });

  it("阅读速度滑杆：数值采纳、越界钳制；非数值忽略状态原样（fail-closed）", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setAutoReadCps(control("24"));
    expect(preferences.autoReadCps).toBe(24);
    expect(panel.view.value.autoReadCps).toBe(24);
    panel.setAutoReadCps(control(String(AUTO_READ_CPS_RANGE.max + 100)));
    expect(preferences.autoReadCps).toBe(AUTO_READ_CPS_RANGE.max);
    panel.setAutoReadCps(control("not-a-number"));
    expect(preferences.autoReadCps).toBe(AUTO_READ_CPS_RANGE.max); // 原样
    panel.dispose();
  });

  it("未读即停开关：事件转核心 setter，镜像即时跟上", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setSkipUnseenOnly(checkbox(true));
    expect(preferences.skipUnseenOnly).toBe(true);
    expect(panel.view.value.skipUnseenOnly).toBe(true);
    panel.setSkipUnseenOnly(checkbox(false));
    expect(panel.view.value.skipUnseenOnly).toBe(false);
    panel.dispose();
  });
});

describe("文本外观写入口", () => {
  it("字体下拉：选中采纳、空值清除（跟随工程默认）", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setFontFamily(control("SourceHanSerif"));
    expect(preferences.fontFamily).toBe("SourceHanSerif");
    expect(panel.view.value.fontFamily).toBe("SourceHanSerif");
    panel.setFontFamily(control(""));
    expect(preferences.fontFamily).toBeUndefined();
    expect(panel.view.value.fontFamily).toBeUndefined();
    panel.dispose();
  });

  it("字速源下拉：story/player 采纳、空值清除；词表外忽略状态原样", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setTextSpeedSource(control("story"));
    expect(preferences.textSpeedSource).toBe("story");
    panel.setTextSpeedSource(control("player"));
    expect(preferences.textSpeedSource).toBe("player");
    panel.setTextSpeedSource(control("bogus"));
    expect(preferences.textSpeedSource).toBe("player"); // 原样
    panel.setTextSpeedSource(control(""));
    expect(preferences.textSpeedSource).toBeUndefined();
    expect(panel.view.value.textSpeedSource).toBeUndefined();
    panel.dispose();
  });
});

describe("镜像与生命周期", () => {
  it("onChanged 随写入口同步触发（宿主即时生效信号）", () => {
    const preferences = new PlayerPreferences();
    const onChanged = vi.fn();
    const panel = createPreferencesPanel({ preferences, onChanged });
    panel.setAutoEnabled(checkbox(true));
    panel.setAutoDelayMs(control("3000"));
    panel.setSkipUnseenOnly(checkbox(true));
    expect(onChanged).toHaveBeenCalledTimes(3);
    panel.dispose();
  });

  it("dispose 退订：卸载后偏好变更不再刷新镜像", () => {
    const preferences = new PlayerPreferences();
    const panel = createPreferencesPanel({ preferences });
    panel.setAutoEnabled(checkbox(true));
    const before = panel.view.value;
    panel.dispose();
    preferences.setAutoDelayMs(4000);
    expect(panel.view.value).toBe(before); // 镜像停在退订前
    expect(preferences.autoDelayMs).toBe(4000); // 核心状态照常
  });
});
