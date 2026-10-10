/**
 * 挂载点模板**接线互锁**（两宿主）。
 *
 * 为什么需要源级守卫：模板注册表是纯函数（已由 `tests/ui/templates/**` 覆盖），
 * 但「宿主有没有真的把模板产出接到 DOM 上」是**接线事实**——单测跑不到 Vue 模板，
 * 浏览器里验证又只能在手跑时看一次。这里把接线钉死：
 * 骨架挂点必须来自模板产出（而非宿主自己拼字符串）、点击必须仍走核心 `choose`、
 * 交互控件必须有可访问名（`v-html` 内容不进无障碍名计算）。
 *
 * 与其它源级接线守卫同套路：读源码断言接线，防「抽象做完了但没人用」。
 */
import { describe, expect, it } from "vitest";
import previewHost from "../../../apps/editor/src/components/PreviewHost.vue?raw";

/**
 * playground 宿主扫描面：App.vue 拆分后，接线字样散在宿主与其面板组件里，
 * 扫描面随之放大为宿主源码全量拼接（只增不减）。本文件的断言均与顺序无关；
 * 保序类契约仍锚单文件，见 tests/ui/input/scope.test.ts。
 */
const playgroundSources = import.meta.glob(
  "../../../apps/playground/src/**/*.{vue,ts}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;
const playgroundKeys = Object.keys(playgroundSources);
const appVueKey = playgroundKeys.find((key) => key.endsWith("/App.vue"));
if (appVueKey === undefined) {
  throw new Error("扫描面缺 App.vue：glob 模式与目录结构失配");
}

/** 去注释后再匹配（守卫对象是代码，不是注释里的字样） */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");

const HOSTS = [
  { label: "playground", src: code(Object.values(playgroundSources).join("\n")) },
  { label: "editor-preview", src: code(previewHost) },
];

describe("挂载点模板 · 接线互锁（两宿主）", () => {
  it.each(HOSTS)("$label：选择层骨架挂点来自模板产出", ({ src }) => {
    // 扫描面守卫：宿主与面板族至少在场（glob 模式失配会让断言静默扫空）
    expect(playgroundKeys.length).toBeGreaterThanOrEqual(6);
    // 注册了默认模板（未知名回退到它）
    expect(src).toMatch(/createChoiceTemplateRegistry\(\)/);
    expect(src).toMatch(/builtinChoiceTemplate/);
    // 骨架挂点接的是模板产出（而非宿主自拼字符串）
    expect(src).toMatch(/choiceView\.rootClass/);
    expect(src).toMatch(/choiceView\.promptHtml/);
    expect(src).toMatch(/choiceView\.optionHtml\[/);
  });

  it.each(HOSTS)("$label：选项点击仍走核心 choose（模板不改叙事流向）", ({ src }) => {
    expect(src).toMatch(/@click[^>]*choose\(/);
  });

  it.each(HOSTS)("$label：v-html 渲染的选项按钮带可访问名", ({ src }) => {
    // 无障碍名必须由宿主显式给出：v-html 内容不进无障碍树计算
    expect(src).toMatch(/:aria-label="(opt|choice)\.text"/);
  });

  it.each(HOSTS)("$label：通知层骨架挂点来自模板产出", ({ src }) => {
    expect(src).toMatch(/createNotifyTemplateRegistry\(\)/);
    expect(src).toMatch(/builtinNotifyTemplate/);
    expect(src).toMatch(/\.rootClass/);
    expect(src).toMatch(/\.bodyHtml/);
  });

  it.each(HOSTS)("$label：通知 tone 由事件透传（预览/宿主不得写死 info）", ({ src }) => {
    // tone 必须来自 payload 或已归一化的条目字段——写死字面量会让警告/错误皮肤失真
    expect(src).toMatch(/toNotifyTone\(/);
    expect(src).not.toMatch(/tone:\s*"info"\s*,\s*\}\)/);
  });
});

describe("挂载点模板 · 未引入第二套布局语言", () => {
  it("宿主不解析模板产出的 HTML 结构（只做挂点填充）", () => {
    for (const { src } of HOSTS) {
      // 反面：宿主若开始「拆开模板产出的 HTML 再重组」，说明骨架归属被破坏
      expect(src).not.toMatch(/optionHtml\[[^\]]*\]\.replace\(/);
      expect(src).not.toMatch(/DOMParser|innerHTML\s*=\s*[^;]*optionHtml/);
    }
  });
});
