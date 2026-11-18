/**
 * 脚手架 i18n 接线判据：三壳供给形态、门面装配序、玩家文案 t() 覆盖与 DOM 边界。
 *
 * 为什么是源码互锁而不是单元测试：`bootHost` 要 fetch/localStorage/VideoPort 全套，
 * 跑不起来；这里守的是**装配层的形状**——端口先于引擎、门面绑同一引擎、
 * 静态文案经 t() 查表、供给形态按壳分流。这些一旦漂移，用户工程里就是
 * 「切了语言没反应」或「桌面壳 invoke 未注册命令」，都在第一次切语言时现形。
 *
 * 与既有判据的分工：句柄形状/拆除序归 `host-handle.test.ts`，清单扫描归
 * `tests/tools/template-lang-list.test.ts`（工具域，真走磁盘），本文件只管接线。
 * 用 `?raw` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import bootSource from "../../template/v1/__PROJECT__/src/host/boot.ts?raw";
import i18nSource from "../../template/v1/__PROJECT__/src/host/i18n.ts?raw";
import hostIndex from "../../template/v1/__PROJECT__/src/host/index.ts?raw";
import stageDomSource from "../../template/v1/__PROJECT__/src/host/stage-dom.ts?raw";
import dialogueSource from "../../template/v1/__PROJECT__/src/host/dialogue-view.ts?raw";
import wiringSource from "../../template/v1/__PROJECT__/src/host/engine-wiring.ts?raw";
import prefsSource from "../../template/v1/__PROJECT__/src/host/panels/preferences.ts?raw";
import historySource from "../../template/v1/__PROJECT__/src/host/panels/history.ts?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import langsIndex from "../../template/v1/__PROJECT__/src/langs/index.ts?raw";
import indexHtml from "../../template/v1/__PROJECT__/index.html?raw";
import viteEnv from "../../template/v1/__PROJECT__/src/vite-env.d.ts?raw";
import vitePlugins from "../../template/v1/__PROJECT__/vite.plugins.ts?raw";
import viteConfig from "../../template/v1/__PROJECT__/vite.config.ts?raw";
import vueMain from "../../template/v1/overlays/vue/src/main.ts?raw";
import vueApp from "../../template/v1/overlays/vue/src/App.vue?raw";
import vueEnv from "../../template/v1/overlays/vue/src/vite-env.d.ts?raw";
import vueConfig from "../../template/v1/overlays/vue/vite.config.ts?raw";
import reactMain from "../../template/v1/overlays/react/src/main.tsx?raw";
import reactApp from "../../template/v1/overlays/react/src/App.tsx?raw";
import reactEnv from "../../template/v1/overlays/react/src/vite-env.d.ts?raw";
import reactConfig from "../../template/v1/overlays/react/vite.config.ts?raw";
import mpHost from "../../template/v1/overlays/miniprogram/src/mp/host.ts?raw";
import mpPage from "../../template/v1/overlays/miniprogram/src/pages/index/index.vue?raw";
import mpBar from "../../template/v1/overlays/miniprogram/src/components/SaveLoadBar.vue?raw";
import mpConfig from "../../template/v1/overlays/miniprogram/vite.config.ts?raw";
import nativePorts from "../../template/v1/__PROJECT__/src/host/native-ports.ts?raw";
import enMain from "../../template/v1/__PROJECT__/Resources/Lang/en/host/main.json?raw";
import enHistory from "../../template/v1/__PROJECT__/Resources/Lang/en/host/panels/history.json?raw";
import enPrefs from "../../template/v1/__PROJECT__/Resources/Lang/en/host/panels/preferences.json?raw";

describe("装配 · 端口先于引擎，门面绑同一引擎", () => {
  it("供给端口在引擎构造之前建好，且可经 BootPortOverrides 覆盖", () => {
    expect(bootSource).toContain(
      "options.ports?.i18n ?? createHostI18nPort(options.langs ?? [])",
    );
    const portAt = bootSource.indexOf("const i18nPort");
    const engineAt = bootSource.indexOf("const engine = new StoryEngine(");
    expect(portAt).toBeGreaterThanOrEqual(0);
    expect(engineAt).toBeGreaterThan(portAt);
    // 引擎构造参数里确实收了端口（setLanguage 按需取件的通路）
    expect(bootSource).toMatch(
      /const engine = new StoryEngine\(\s*story,\s*\{[\s\S]*?i18nPort,[\s\S]*?\}\s*\);/,
    );
  });

  it("门面用 shell 包的 createHostI18n，绑的是同一个引擎与端口", () => {
    expect(bootSource).toContain('from "@lingfan-engine/shell"');
    expect(bootSource).toContain("createHostI18n(engine, { i18nPort })");
  });

  it("BootPortOverrides 增 i18n 槽位；HostBootOptions 增 langs 清单入口", () => {
    expect(bootSource).toContain("i18n?: I18nPort;");
    expect(bootSource).toContain("langs?: readonly I18nLangEntry[];");
  });

  it("语言接线在面板挂载之后、拆除时先于渲染器（订阅回调不打到死面板）", () => {
    const wireAt = bootSource.indexOf("wireHostI18n({");
    const panelAt = bootSource.indexOf("historyPanel?.mount()");
    expect(wireAt).toBeGreaterThan(panelAt);
    const disposeAt = bootSource.indexOf("i18nWiring.dispose()");
    const audioAt = bootSource.indexOf("audio.dispose()");
    expect(disposeAt).toBeGreaterThanOrEqual(0);
    expect(disposeAt).toBeLessThan(audioAt);
  });

  it("host/index.ts 同步转发 i18n 装配出口", () => {
    expect(hostIndex).toContain("createHostI18nPort");
    expect(hostIndex).toContain("wireHostI18n");
    expect(hostIndex).toContain('} from "./i18n";');
  });
});

describe("供给形态 · 浏览器/桌面走 Web fetch，小程序走 HTTP", () => {
  it("骨架端口工厂就是 adapters 的 createFetchI18nPort（Lang/ 是静态资源）", () => {
    expect(i18nSource).toContain("createFetchI18nPort({ langs })");
    expect(i18nSource).not.toContain("createTauriI18nPort");
  });

  it("桌面壳不换译文端口：native-ports 只换存档（Rust 未注册 i18n 命令）", () => {
    expect(nativePorts).not.toContain("I18n");
    expect(nativePorts).not.toContain("i18n");
  });

  it("小程序用可注入 HttpFetch 的 HTTP 形态，基址与故事同源", () => {
    expect(mpHost).toContain("createHttpI18nPort({");
    expect(mpHost).toContain("root: projectBaseUrl");
    expect(mpHost).toContain("fetch: createRequestFetch()");
    expect(mpHost).not.toContain("createFetchI18nPort");
    expect(mpHost).not.toContain("createTauriI18nPort");
    // 端口先于引擎；门面绑同一引擎；句柄交出 i18n
    const portAt = mpHost.indexOf("const i18nPort");
    const engineAt = mpHost.indexOf("const engine = new StoryEngine(");
    expect(portAt).toBeGreaterThanOrEqual(0);
    expect(engineAt).toBeGreaterThan(portAt);
    expect(mpHost).toMatch(
      /const engine = new StoryEngine\(\s*story,\s*\{[\s\S]*?i18nPort,[\s\S]*?\}\s*\);/,
    );
    expect(mpHost).toContain("createHostI18n(engine, { i18nPort })");
    expect(mpHost).toContain("i18n: HostI18n;");
  });

  it("小程序清单直接取虚拟模块（自包含，不依赖骨架 src/langs 出口）", () => {
    expect(mpHost).toContain('import { LANGS } from "virtual:lang-list";');
  });
});

describe("语言清单通路 · 虚拟模块 → 出口 → 组合根", () => {
  it("骨架 vite.plugins 薄转发 langListVirtual，四处 vite.config 都接上", () => {
    expect(vitePlugins).toContain("langListVirtual");
    expect(vitePlugins).toContain(
      'from "@lingfan-engine/stories-build/host-plugins"',
    );
    for (const [name, config] of [
      ["骨架", viteConfig],
      ["vue", vueConfig],
      ["react", reactConfig],
      ["miniprogram", mpConfig],
    ] as const) {
      expect(config, name).toContain("langListVirtual()");
    }
  });

  it("virtual:lang-list 声明在骨架与两个框架覆盖层都在（覆盖层须声明全集）", () => {
    for (const [name, env] of [
      ["骨架", viteEnv],
      ["vue", vueEnv],
      ["react", reactEnv],
    ] as const) {
      expect(env, name).toContain('declare module "virtual:lang-list"');
      expect(env, name).toContain("LANGS: readonly I18nLangEntry[]");
    }
  });

  it("src/langs 出口只转发虚拟模块（与 src/stories 同构，清单来自磁盘）", () => {
    expect(langsIndex).toContain('export { LANGS } from "virtual:lang-list";');
  });

  it("三个组合根都把 langs: LANGS 交给 bootHost", () => {
    for (const [name, main] of [
      ["骨架", skeletonMain],
      ["vue", vueMain],
      ["react", reactMain],
    ] as const) {
      expect(main, name).toContain("langs: LANGS");
      expect(main, name).toContain('from "./langs"');
    }
  });
});

describe("语言选择器 · 节点、句柄与接线", () => {
  it("骨架页面与两个框架视图都有 #lang 与 #save-label", () => {
    for (const [name, view] of [
      ["骨架", indexHtml],
      ["vue", vueApp],
      ["react", reactApp],
    ] as const) {
      expect(view, name).toContain('id="lang"');
      expect(view, name).toContain('id="save-label"');
    }
  });

  it("句柄按可选口径（overlay 页面可不给），三个组合根同步取", () => {
    expect(stageDomSource).toContain("lang?: HTMLSelectElement | null;");
    expect(stageDomSource).toContain("saveLabel?: HTMLElement | null;");
    for (const [name, main] of [
      ["骨架", skeletonMain],
      ["vue", vueMain],
      ["react", reactMain],
    ] as const) {
      expect(main, name).toContain('optional<HTMLSelectElement>("#lang")');
      expect(main, name).toContain('optional("#save-label")');
    }
  });

  it('默认语言映射 value=""（传语言码会 fail-closed），常量取自 core', () => {
    expect(i18nSource).toContain(
      'option.value = lang === DEFAULT_LANG ? "" : lang;',
    );
    expect(i18nSource).toContain(
      'import { DEFAULT_LANG, type I18nPort } from "@lingfan-engine/core"',
    );
    expect(i18nSource).not.toContain('"zh-CN"');
  });

  it("选择器 change → changeLang；门面出站 → 回写选中值并重画静态文案", () => {
    expect(i18nSource).toContain("i18n.changeLang(select.value)");
    expect(i18nSource).toContain("i18n.subscribe((lang) => {");
    expect(i18nSource).toContain("select.value = lang;");
    expect(i18nSource).toContain("applyStaticTexts();");
    expect(i18nSource).toContain("dialogue.setMenuChanged();");
    // 偏好面板重挂载重画行标签；历史面板就地重画保留展开态；dispose 退订并解绑
    expect(i18nSource).toContain("prefsPanel?.mount();");
    expect(i18nSource).toContain("historyPanel?.refresh();");
    // 历史面板切语言不重挂载（重挂载会丢展开态）：i18n 接线里不得出现它的 destroy/mount
    expect(i18nSource).not.toContain("historyPanel?.destroy();");
    expect(i18nSource).not.toContain("historyPanel?.mount();");
    expect(i18nSource).toContain("unsubscribe();");
    expect(i18nSource).toContain('removeEventListener("change", onChange)');
  });

  it("小程序页面响应式读门面：currentLang/availableLangs 镜像进 ref，picker 切换", () => {
    expect(mpPage).toContain('const currentLang = ref("")');
    expect(mpPage).toContain("started.i18n.subscribe(");
    expect(mpPage).toContain("current.i18n.currentLang.value");
    expect(mpPage).toContain("current.i18n.availableLangs");
    expect(mpPage).toContain('@change="onLangChange"');
    // 默认语言同样映射空串（与骨架选择器同口径）
    expect(mpPage).toContain('lang === DEFAULT_LANG ? "" : lang');
    expect(mpPage).toContain("stopLangWatch");
    expect(mpPage).not.toContain('"zh-CN"');
  });
});

describe("玩家文案 t() · 只包宿主字面量，故事内容不二次查表", () => {
  it("四个视图/面板都收可选 translate（缺省恒等 = 原文直出）", () => {
    for (const [name, source] of [
      ["dialogue-view", dialogueSource],
      ["engine-wiring", wiringSource],
      ["preferences", prefsSource],
      ["history", historySource],
    ] as const) {
      expect(source, name).toContain("translate?: (text: string) => string;");
      expect(source, name).toContain(
        "options.translate ?? ((text: string): string => text)",
      );
    }
    // boot 把门面的 t 交给四处（同一张表）
    const injections = bootSource.match(/translate: i18n\.t,/g) ?? [];
    expect(injections).toHaveLength(4);
  });

  it("对话视图：确定钮与两条等待提示包 t()，minigame 诊断不迁", () => {
    expect(dialogueSource).toContain('t("确定")');
    expect(dialogueSource).toContain('t("视频播放中……（点击或空格跳过）")');
    expect(dialogueSource).toContain('t("等待中……（点击或空格跳过）")');
    // 故事内容（菜单/输入提示/候选）来自引擎状态，不再包 t()
    // 词边界防误报：engine.input(candidate 含子串 t(candidate，不是 t() 调用
    expect(dialogueSource).not.toMatch(
      /(?<![A-Za-z])t\((?:prompt|label|candidate)/,
    );
  });

  it("存读档 toast：字面量部分包 t()，槽号拼接保留；诊断与 notify 不迁", () => {
    expect(wiringSource).toContain(
      'options.toast(`${t("已保存到")} ${payload.slot}`)',
    );
    expect(wiringSource).toContain(
      'options.toast(`${t("已读取")} ${payload.slot}`)',
    );
    expect(wiringSource).toContain("options.toast(payload.text)");
    expect(wiringSource).not.toContain('t("启动失败');
  });

  it("偏好面板：四通道名走字面量映射（扫描器只认字面量首参）", () => {
    for (const literal of [
      't("BGM")',
      't("音效")',
      't("环境")',
      't("语音")',
      't("静音")',
      't("文字速度")',
      't("字/秒")',
    ]) {
      expect(prefsSource, literal).toContain(literal);
    }
    expect(prefsSource).toContain("channelLabel(entry.channel)");
    // 导出常量保留（既有测试与缺省展示值还用它）
    expect(prefsSource).toContain("export const PREF_CHANNELS");
  });

  it("历史面板：开合按钮两种文案都包 t()", () => {
    expect(historySource).toContain('openState ? t("关闭历史") : t("历史")');
    expect(historySource).toContain('button.textContent = t("历史");');
  });

  it("宿主静态工具条文案在 i18n 装配里包 t()（页面初值只译一次）", () => {
    expect(i18nSource).toContain('t("存")');
    expect(i18nSource).toContain('t("读")');
    expect(i18nSource).toContain('t("存档")');
    expect(i18nSource).toContain('dom.text.textContent = t("加载中……");');
  });

  it("小程序 SaveLoadBar：七处玩家文案包 t()，槽位标题不二次查表", () => {
    expect(mpBar).toContain("translate?: (text: string) => string;");
    for (const literal of [
      't("存")',
      't("读")',
      't("关闭")',
      't("写入存档")',
      't("读取存档")',
      't("空槽")',
      't("已有存档")',
    ]) {
      expect(mpBar, literal).toContain(literal);
    }
    expect(mpPage).toContain(':translate="translate"');
    // 页面 translate 读 currentLang 建立响应式依赖（切语言自动重渲）
    expect(mpPage).toContain("current.i18n.t(text)");
  });
});

describe("样例键覆盖 · t() 字面量都能在 Lang/en 里查到", () => {
  /** 三个宿主 overlay 合并成一张表（运行期合并语义的投影） */
  const sampleKeys = new Set<string>([
    ...Object.keys(JSON.parse(enMain) as Record<string, string>),
    ...Object.keys(JSON.parse(enHistory) as Record<string, string>),
    ...Object.keys(JSON.parse(enPrefs) as Record<string, string>),
  ]);

  it("宿主代码里每个 t() 字面量都有样例译文", () => {
    for (const [name, source] of [
      ["dialogue-view", dialogueSource],
      ["engine-wiring", wiringSource],
      ["preferences", prefsSource],
      ["history", historySource],
      ["i18n", i18nSource],
      ["SaveLoadBar", mpBar],
    ] as const) {
      for (const match of source.matchAll(/\bt\("([^"]+)"\)/g)) {
        expect(
          sampleKeys.has(match[1]!),
          `${name} 的「${match[1]}」缺样例译文`,
        ).toBe(true);
      }
    }
  });
});

describe("DOM 边界 · i18n 新增模块不越层", () => {
  it("DOM 只出现在 src/host/i18n.ts；src/langs 出口是纯转发", () => {
    expect(langsIndex).not.toMatch(/document\.|window\./);
    // 框架形态的静态节点由 boot 经句柄重画：App 不接引擎、不接门面
    expect(vueApp).not.toContain("engine");
    expect(reactApp).not.toContain("engine");
    expect(vueApp).not.toContain("HostI18n");
    expect(reactApp).not.toContain("HostI18n");
  });

  it("小程序平台面仍只有 platform.ts 一处碰 uni（i18n 接线不新增取用点）", () => {
    // 只认调用形态（注释里提到 uni.request 是说明文字，不算取用）
    expect(mpHost).not.toMatch(/\buni\.[A-Za-z]+\(/);
    expect(mpPage).not.toMatch(/\buni\.[A-Za-z]+\(/);
  });
});
