/**
 * 降级打开（#11）**接线互锁**：判据（synthesizeDegradedManifest）与适配器
 * （readProject 降级路径）都有了，App/组合根没接上 = 用户看不到「降级打开」
 * ——降级必须显式告知，静默 = 白做。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import mainSource from "../../apps/editor/src/main.ts?raw";
import statusBarSource from "../../apps/editor/src/components/StatusBar.vue?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("降级打开 · 接线互锁", () => {
  it("🔴 组合根把降级回执**透传进 OpenedProject**（断在半路 = 界面永远不知道）", () => {
    const src = code(mainSource);
    expect(src).toContain("filesPort.degraded?.()");
    expect(src).toContain("degraded,");
  });

  it("🔴 降级工程的**打开基线不含清单**（读不存在的 project.json 会在打开时炸）", () => {
    const src = code(mainSource);
    // 条件装配：degraded === undefined 才读清单原文
    expect(src).toContain("degraded === undefined");
    expect(src).toMatch(/await source\.text\(MANIFEST_FILE\)/);
  });

  it("🔴 App 状态贯通：applyOpened 记账、unbindProject 作废、StatusBar 接收", () => {
    const src = code(appSource);
    expect(src).toContain("degradedOpen.value = opened.degraded");
    expect(src).toContain("degradedOpen.value = undefined");
    expect(src).toContain(':degraded="degradedOpen"');
  });

  it("🔴 状态栏显示「降级打开」且**详情可读**（role=status + title=reason）", () => {
    const src = code(statusBarSource);
    expect(src).toContain("降级打开");
    expect(src).toContain('role="status"');
    expect(src).toContain(":title=\"degraded.reason\"");
  });
});
