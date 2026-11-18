/**
 * 三类新诊断的**面板接线互锁**（孤儿键 / 宿主未标记文案 / 布局冲突）。
 *
 * 为何要补：数据与判据（analyzeStory 可选供给、reconcile、ast-scan）各有测试，
 * 但「供给 → App → 面板」这条链没守卫 —— 判据通过、组件写好了，却没接进界面
 * 是常见漏法。本守卫锁住每一跳：
 * - App 把供给的 unmarkedHostTexts / layoutConflicts 喂进 analyzeStory（体检面板）；
 * - App → RightPane → LangWorkbench、App → CenterStage → LangView 的 props 透传；
 * - 两个面板真的渲染三类诊断（未标记定位、冲突键、孤儿徽标），冲突可跳转打开文件；
 * - LangWorkbench 仍从 dialogInjection 取件（app 聚合出口取件会成 import 环）。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import rightPaneSource from "../../apps/editor/src/components/panes/RightPane.vue?raw";
import centerSource from "../../apps/editor/src/components/panes/CenterStage.vue?raw";
import workbenchSource from "../../apps/editor/src/components/panels/LangWorkbench.vue?raw";
import langViewSource from "../../apps/editor/src/components/panels/LangView.vue?raw";
import i18nWorkbenchSource from "../../apps/editor/src/app/useI18nWorkbench.ts?raw";

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("体检面板：供给 → analyzeStory（诊断码那一半）", () => {
  it("App 把两类新供给喂进 analyzeStory（缺席 = undefined，诊断族跳过）", () => {
    const src = code(appSource);
    expect(src).toContain("unmarkedHostTexts: supply.unmarkedHostTexts");
    expect(src).toContain("layoutConflicts: supply.layoutConflicts");
  });

  it("工作台语言摘要接的是真实文件表投影（不是自己再硬猜 main.json）", () => {
    const src = code(i18nWorkbenchSource);
    expect(src).toContain("projectLangSummaries(diagnosticSupply.value)");
    expect(src).toContain("supply.overlayFilesByLang");
  });
});

describe("语言工作台：App → RightPane → LangWorkbench 透传", () => {
  it("App 给 RightPane 传未标记与冲突（模板 ref 自动解包，不带 .value）", () => {
    const src = code(appSource);
    expect(src).toContain(
      ':i18n-unmarked="diagnosticSupply?.unmarkedHostTexts"',
    );
    expect(src).toContain(
      ':i18n-conflicts="diagnosticSupply?.layoutConflicts"',
    );
  });

  it("RightPane 原样转给 LangWorkbench", () => {
    const src = code(rightPaneSource);
    expect(src).toContain(':unmarked="props.i18nUnmarked"');
    expect(src).toContain(':conflicts="props.i18nConflicts"');
  });

  it("LangWorkbench 渲染两节诊断（未标记带定位；冲突可打开第一处文件）", () => {
    const src = code(workbenchSource);
    expect(src).toContain('data-kind="unmarked"');
    expect(src).toContain('data-kind="conflict"');
    expect(src).toContain("{{ site.file }}:{{ site.line }}:{{ site.column }}");
    expect(src).toContain(
      "@click=\"conflict.sites[0] && emit('open', conflict.sites[0].path)\"",
    );
  });

  it("取件仍走 dialogInjection（不新造 app 聚合出口 import 环）", () => {
    expect(code(workbenchSource)).toContain("../../app/dialogInjection");
  });
});

describe("译文表视图：App → CenterStage → LangView 透传", () => {
  it("App 给 CenterStage 传原文键集与冲突", () => {
    const src = code(appSource);
    expect(src).toContain(':i18n-sources="i18nSources"');
    expect(src).toContain(
      ':i18n-conflicts="diagnosticSupply?.layoutConflicts"',
    );
  });

  it("CenterStage 原样转给 LangView", () => {
    const src = code(centerSource);
    expect(src).toContain(':sources="props.i18nSources"');
    expect(src).toContain(':conflicts="props.i18nConflicts"');
  });

  it("LangView 渲染孤儿提示 + 行内徽标 + 本文件冲突提示（供给缺席不判）", () => {
    const src = code(langViewSource);
    expect(src).toContain('class="orphan-hint"');
    expect(src).toContain('class="conflict-hint"');
    expect(src).toContain('v-if="orphanKeys.has(row.key)"');
    // 孤儿判定以原文键集供给为前提（缺席 = 空集，不臆造「全是孤儿」）
    expect(src).toContain("props.sources === undefined");
    // 冲突只报与本文件相关的（sites 命中当前 path）
    expect(src).toContain("site.path === props.path");
  });
});
