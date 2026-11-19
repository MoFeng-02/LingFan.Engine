/**
 * 小程序设置面板与脚手架无障碍接线的防腐测试。
 *
 * 设置面板的音量/静音/字速必须经玩家偏好层写回（合成与防抖落盘都在那一处），
 * 组件自己不碰存储；页面把宿主句柄的偏好实例交进面板。交互控件逐个有可访问名，
 * 台词与错误条有读屏播报。这些是「够得到」的宿主义务，源文本断言防止被悄悄拆掉。
 */
import { describe, expect, it } from "vitest";
import settingsPanel from "../../template/v1/overlays/miniprogram/src/components/SettingsPanel.vue?raw";
import mpPage from "../../template/v1/overlays/miniprogram/src/pages/index/index.vue?raw";
import baseHtml from "../../template/v1/__PROJECT__/index.html?raw";
import vueApp from "../../template/v1/overlays/vue/src/App.vue?raw";

describe("小程序设置面板经偏好层读写", () => {
  it("音量/静音/字速都写回偏好层，不直接落盘", () => {
    expect(settingsPanel).toContain("props.preferences?.setVolume(");
    expect(settingsPanel).toContain("props.preferences?.setMuted(");
    expect(settingsPanel).toContain("props.preferences?.setTextSpeed(");
    // 组件不自己持久化：防抖落盘归偏好层
    expect(settingsPanel).not.toContain("localStorage");
    expect(settingsPanel).not.toContain("wx.setStorage");
    expect(settingsPanel).not.toContain("setStorageSync");
  });

  it("镜像偏好快照并订阅 onChange（外部改动也回填）", () => {
    expect(settingsPanel).toContain("prefs.snapshot()");
    expect(settingsPanel).toContain("prefs.onChange(sync)");
  });

  it("页面把宿主偏好实例交进面板", () => {
    expect(mpPage).toContain("prefs.value = started.preferences");
    expect(mpPage).toContain("<SettingsPanel");
    expect(mpPage).toContain(':preferences="prefs"');
  });
});

describe("交互控件可访问名（aria 宿主义务）", () => {
  it("基础骨架工具栏逐控件有 aria-label，台词与错误条有播报", () => {
    expect(baseHtml).toContain('id="save" aria-label="存档"');
    expect(baseHtml).toContain('id="load" aria-label="读档"');
    expect(baseHtml).toContain('id="slot" aria-label="存档槽位"');
    expect(baseHtml).toContain('id="lang" aria-label="语言"');
    expect(baseHtml).toContain('id="text" aria-live="polite"');
    expect(baseHtml).toContain('id="error" role="alert"');
    // 槽位选择器与文案标签关联（读屏念得出「存档」）
    expect(baseHtml).toContain('for="slot"');
  });

  it("vue 形态工具栏与基础骨架同口径", () => {
    expect(vueApp).toContain('id="save" aria-label="存档"');
    expect(vueApp).toContain('id="load" aria-label="读档"');
    expect(vueApp).toContain('id="slot" aria-label="存档槽位"');
    expect(vueApp).toContain('id="lang" aria-label="语言"');
    expect(vueApp).toContain('id="text" aria-live="polite"');
    expect(vueApp).toContain('id="error" role="alert"');
  });

  it("设置面板逐滑杆/开关有 aria-label", () => {
    expect(settingsPanel).toContain(":aria-label=");
    expect(settingsPanel).toContain('aria-label="打开设置面板"');
    expect(settingsPanel).toContain('aria-label="关闭设置面板"');
  });
});
