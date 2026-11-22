/**
 * 引擎门面的界面接线契约（源级扫描，与 browser-i18n-wiring 同一手法）：
 * - 标题屏四按钮（开始旅程/继续/读取存档/功能巡览）与语言切换都发真实事件，
 *   背景走绑定而非静态属性（资源根逻辑路径），继续有智能态与最近进度摘要
 * - 工具条 Auto/Skip 是可见切换按钮：激活态高亮 + aria-pressed，事件交宿主
 * - 宿主把 Auto 翻在偏好上（与偏好面板单一事实源）、Skip 以引擎运行态起停
 *   （与按住 Ctrl 单一事实源）；重启换实例后按偏好重新装配 auto
 * - 偏好扩展面板五个真控件直拿句柄写核心；缓办项只留诚实禁用占位
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/playground/src/App.vue?raw";
import toolbarSource from "../../apps/playground/src/App/ToolbarPanel.vue?raw";
import extrasSource from "../../apps/playground/src/App/settings/PreferenceExtras.vue?raw";
import autoSkipSource from "../../apps/playground/src/host/panels/wiring/app-prefs.ts?raw";
import startSource from "../../apps/playground/src/pages/start/start.vue?raw";

describe("标题屏", () => {
  it("四按钮与语言切换都发真实事件，无装饰死按钮", () => {
    expect(startSource).toContain("emit('start')");
    expect(startSource).toContain("emit('continue', resume)");
    expect(startSource).toContain("emit('toggleSaves')");
    expect(startSource).toContain("emit('tour')");
    expect(startSource).toContain("emit('change-lang'");
    // 文案经译文门面（未命中回原文），不硬编码单语
    expect(startSource).toContain("props.t?.(text) ?? text");
  });

  it("背景图走绑定（资源根逻辑路径），压暗层浮于其上", () => {
    expect(startSource).toContain('const BACKDROP = "Images/worldmap.svg";');
    expect(startSource).toContain(':src="BACKDROP"');
    expect(startSource).toContain('class="start-page__shade"');
  });

  it("继续智能态：无存档禁用，有存档显示最近进度摘要", () => {
    expect(startSource).toContain(`:disabled="resume === ''"`);
    expect(startSource).toContain('v-if="resumeView"');
    expect(startSource).toContain("props.saves.find(");
  });

  it("巡览与语言切换由宿主接到引擎能力", () => {
    expect(appSource).toContain(`@tour="onEnterColumn('tour')"`);
    expect(appSource).toContain(`@change-lang="changeLang"`);
  });
});

describe("工具条 Auto/Skip", () => {
  it("可见切换按钮：激活态高亮 + aria-pressed，事件交宿主", () => {
    expect(toolbarSource).toContain("autoOn?: boolean;");
    expect(toolbarSource).toContain("skipOn?: boolean;");
    expect(toolbarSource).toContain('"toggle-auto": [];');
    expect(toolbarSource).toContain('"toggle-skip": [];');
    expect(toolbarSource).toContain(`:class="{ 'is-on': autoOn }"`);
    expect(toolbarSource).toContain(`:class="{ 'is-on': skipOn }"`);
    expect(toolbarSource).toContain(':aria-pressed="autoOn ?? false"');
    expect(toolbarSource).toContain(':aria-pressed="skipOn ?? false"');
    expect(toolbarSource).toContain(".auto-skip button.is-on");
  });

  it("Auto 翻偏好（与偏好面板单一事实源），Skip 以引擎运行态起停（与 Ctrl 同源）", () => {
    expect(autoSkipSource).toContain(
      "preferences.setAutoEnabled(!preferences.autoEnabled);",
    );
    expect(autoSkipSource).toContain(
      "if (getEngine().skipActive()) loop.stopSkip();",
    );
    expect(appSource).toContain(':auto-on="autoOn"');
    expect(appSource).toContain(':skip-on="skipActive"');
    expect(appSource).toContain('@toggle-auto="toggleAuto"');
    expect(appSource).toContain('@toggle-skip="toggleSkip"');
  });

  it("重启换实例：先停旧循环节奏，换完按偏好重新装配 auto", () => {
    expect(appSource).toContain('@restart="onRestart"');
    const body = autoSkipSource.slice(
      autoSkipSource.indexOf("onRestart(): void {"),
      autoSkipSource.indexOf("notifyModeChange(): void {"),
    );
    expect(body).toContain("loop.stopSkip();");
    expect(body).toContain("loop.stopAuto();");
    expect(body).toContain("restart();");
    expect(body).toContain("syncAuto();");
    // 读档/回溯清掉会话模式后，叙事变动触发复查重装配
    expect(autoSkipSource).toContain(
      "watch([shownText, canAdvance, modeTick], syncAuto),",
    );
    expect(autoSkipSource).toContain(
      "if (getEngine().skipActive() || getEngine().autoActive()) return;",
    );
  });

  it("宿主接线：键盘按住/松开发模式信号，卸载退订与构造成对", () => {
    expect(appSource).toContain(
      'import { createAppAutoSkip } from "./host/panels/wiring/app-prefs";',
    );
    expect(appSource).toContain("const autoSkip = createAppAutoSkip({");
    expect(appSource).toContain("loop: automatedLoop,");
    expect(appSource).toContain("autoSkip.notifyModeChange();");
    expect(appSource).toContain("autoSkip.dispose();");
  });
});

describe("偏好扩展面板", () => {
  it("五个真控件直拿句柄写核心，撤掉对应死占位", () => {
    expect(extrasSource).toContain("props.prefs.setAutoEnabled($event)");
    expect(extrasSource).toContain("props.prefs.setAutoDelayMs($event)");
    expect(extrasSource).toContain("props.prefs.setSkipUnseenOnly($event)");
    expect(extrasSource).toContain("props.prefs.setFontFamily($event)");
    expect(extrasSource).toContain("props.prefs.setTextSpeedSource($event)");
    expect(extrasSource).not.toContain("待自动播放接线后启用");
    expect(extrasSource).not.toContain("待快进接线后启用");
    expect(extrasSource).not.toContain("待字体注册校验接线后启用");
  });

  it("延时值域引核心常量；字体下拉用注册字体表", () => {
    expect(extrasSource).toContain("AUTO_DELAY_MS_RANGE,");
    expect(extrasSource).toContain(':min="AUTO_DELAY_MS_RANGE.min"');
    expect(extrasSource).toContain(':max="AUTO_DELAY_MS_RANGE.max"');
    expect(extrasSource).toContain(
      'import { storyFonts } from "virtual:story-fonts";',
    );
    expect(extrasSource).toContain('v-for="font in storyFonts"');
  });

  it("缓办项保留禁用 + 诚实说明（打字音效/窗口尺寸）", () => {
    expect(extrasSource).toContain('title="待打字机音效接线后启用"');
    expect(extrasSource).toContain('title="待桌面壳窗口能力接线后启用"');
  });
});
