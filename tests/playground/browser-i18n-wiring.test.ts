/**
 * 参考宿主浏览器形态 I18N 供给的接线互锁（源级判据，?raw 风格）：
 *
 * 组合根装配链横跨 vite 插件 → 虚拟模块 → 出口 → main.ts → 引擎生命周期，
 * 装配 composable 依赖 Vue 组件与真实端口，不在单测里组装；这里锁「线接对了」：
 * - 浏览器形态真接上 fetch 供给（不再只有 Tauri 原生形态有 i18n）；
 * - 语言清单来自构建期 virtual:lang-list（不手抄）；
 * - 引擎重启/重建两条路径都把 i18nPort 传进 EngineOptions；
 * - 语言订阅重绑钩子（onBindEngine）从 App.vue 一路透传到 bindEngine；
 * - 嵌入演示页同样接供给与选项按钮翻译（choiceTranslate）。
 *
 * 供给端口的运行期行为由 tests/adapters/i18n/webI18n.test.ts 锁，
 * 门面的运行期行为由 tests/shell/i18n/host-i18n.test.ts 与
 * tests/playground/app-lang.test.ts 锁。
 */
import { describe, expect, it } from "vitest";
import mainSource from "../../apps/playground/src/main.ts?raw";
import engineSource from "../../apps/playground/src/host/engine/app-engine.ts?raw";
import lifecycleSource from "../../apps/playground/src/host/session/wiring/app-lifecycle.ts?raw";
import appSource from "../../apps/playground/src/App.vue?raw";
import toolbarSource from "../../apps/playground/src/App/ToolbarPanel.vue?raw";
import storiesSource from "../../apps/playground/src/stories/index.ts?raw";
import envSource from "../../apps/playground/src/vite-env.d.ts?raw";
import viteConfigSource from "../../apps/playground/vite.config.ts?raw";
import overlayDemoSource from "../../apps/playground/src/embed/overlayDemo.ts?raw";

/** 剥掉注释（块注释与行注释）——判据只落在代码上，不被说明文字误满足 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("浏览器形态供给：组合根装配", () => {
  it("main.ts 浏览器分支接 createFetchI18nPort，清单来自 LANGS", () => {
    const main = code(mainSource);
    expect(main).toContain("createFetchI18nPort");
    expect(main).toContain("createFetchI18nPort({ langs: LANGS })");
    // 原生形态保留 Tauri 供给（双形态并存，不是替换）
    expect(main).toContain("createTauriI18nPort()");
    // 端口经 createApp 属性注入（宿主装配只见契约）
    expect(main).toContain("i18nPort,");
  });

  it("LANGS 经 stories 出口转发 virtual:lang-list（不手抄清单）", () => {
    expect(code(storiesSource)).toContain(
      'export { LANGS } from "virtual:lang-list"',
    );
    expect(code(envSource)).toContain('declare module "virtual:lang-list"');
    expect(code(envSource)).toContain("export const LANGS");
  });

  it("vite.config.ts 挂 langListVirtual 插件（构建期扫描 + dev watcher）", () => {
    const config = code(viteConfigSource);
    expect(config).toContain("langListVirtual");
    expect(config).toContain("langListVirtual({}, import.meta.url)");
  });
});

describe("引擎重启/重建两条路径都带供给", () => {
  it("app-engine.ts 两处 new StoryEngine 都传 i18nPort: props.i18nPort", () => {
    const engine = code(engineSource);
    const passes = engine.match(/i18nPort: props\.i18nPort/g) ?? [];
    expect(passes.length).toBe(2); // initEngine 与 restart 各一处
    const constructions = engine.match(/new StoryEngine\(/g) ?? [];
    expect(constructions.length).toBe(passes.length);
  });

  it("onBindEngine 钩子在 bindEngine 末尾回调（覆盖 init 与 restart 两路）", () => {
    const engine = code(engineSource);
    expect(engine).toContain("onBindEngine?: () => void");
    expect(engine).toContain("onBindEngine?.();");
    // 生命周期装配透传（App.vue → lifecycle → engineLife）
    expect(code(lifecycleSource)).toContain(
      "onBindEngine: options.onBindEngine",
    );
    expect(code(appSource)).toContain("onBindEngine: bindLang");
  });
});

describe("语言门面与静态文案接线", () => {
  it("App.vue 从 panels 解构 t/bindLang 并把 t 传给工具栏", () => {
    const app = code(appSource);
    expect(app).toContain("t, bindLang");
    expect(app).toContain(':t="t"');
  });

  it("ToolbarPanel 的 t 可选注入：缺省恒等（不传翻译行为与旧版全同）", () => {
    const toolbar = code(toolbarSource);
    expect(toolbar).toContain("t?: (text: string) => string");
    expect(toolbar).toContain("props.t?.(text) ?? text");
    // 玩家可见静态文案经 t()（抽查三处代表：标题、按钮字、语言下拉）
    expect(toolbar).toContain("t('重新开始')");
    expect(toolbar).toContain('t("存")');
    expect(toolbar).toContain("t('语言')");
  });
});

describe("嵌入演示页：供给与选项按钮翻译", () => {
  it("overlayDemo 引擎带 fetch 供给、overlay 接 choiceTranslate", () => {
    const demo = code(overlayDemoSource);
    expect(demo).toContain("i18nPort: createFetchI18nPort({ langs: LANGS })");
    expect(demo).toContain("choiceTranslate: (text) => engine.translate(text)");
  });
});
