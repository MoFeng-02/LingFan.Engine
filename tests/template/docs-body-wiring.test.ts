/**
 * 文档收口防腐：列身体专页双语可达、嵌入演示四步接入与诊断出口不静默、公共面零泄露。
 *
 * 用 ?raw 读源文本断言（与脚手架防腐测试同口径）：文档站构建属发布动作不在门禁跑，
 * 这里只验证「页面在、侧栏指得到、演示有诊断出口、公共面没有内部代号」。
 */
import { describe, expect, it } from "vitest";
import bodyZh from "../../docs/src/content/docs/guides/body-column.md?raw";
import bodyEn from "../../docs/src/content/docs/en/guides/body-column.md?raw";
import astroConfig from "../../docs/astro.config.mjs?raw";
import overlayDemo from "../../apps/playground/src/embed/overlayDemo.ts?raw";
import readme from "../../template/v1/README.md?raw";

describe("列身体专页双语可达（docs-body-page-zh-en）", () => {
  it("中文专页有 frontmatter 与核心内容", () => {
    expect(bodyZh).toContain("title: 列身体：用组件画一整屏");
    expect(bodyZh).toContain("SceneEnv");
    expect(bodyZh).toContain("submit");
    expect(bodyZh).toContain("回溯落在进入组件那一步");
    expect(bodyZh).toContain("src/scenes/");
  });

  it("英文专页有 frontmatter 与核心内容", () => {
    expect(bodyEn).toContain(
      "Column body: paint a whole screen with a component",
    );
    expect(bodyEn).toContain("SceneEnv");
    expect(bodyEn).toContain("submit");
    expect(bodyEn).toContain("src/scenes/");
  });

  it("侧栏指得到列身体专页", () => {
    expect(astroConfig).toContain('link: "/guides/body-column/"');
    expect(astroConfig).toContain("列身体：用组件画一整屏");
  });
});

describe("嵌入演示四步接入与诊断出口（embed-demo-runs / boot-diagnostics-visible）", () => {
  it("四步接入：给容器、建引擎、一行挂载、转发输入", () => {
    expect(overlayDemo).toContain("createNarrativeOverlay");
    expect(overlayDemo).toContain("new StoryEngine");
    expect(overlayDemo).toContain("createDomOverlaySurface");
    expect(overlayDemo).toContain("overlay.advance()");
  });

  it("诊断出口不静默：装配失败与覆盖层错误同一出口", () => {
    expect(overlayDemo).toContain("onError: report");
    expect(overlayDemo).toContain(
      "void main().catch((e: unknown) => report(String(e)))",
    );
    expect(overlayDemo).toContain('errorEl.classList.add("on")');
  });
});

describe("公共面零泄露（内部代号/章节号/私有路径不入文档与 README）", () => {
  const pages: ReadonlyArray<readonly [string, string]> = [
    ["中文专页", bodyZh],
    ["英文专页", bodyEn],
    ["模板 README", readme],
  ];

  it.each(pages)("%s 不含审计/任务/裁定代号", (_name, text) => {
    expect(text).not.toMatch(/\b[ZTRB]\d{1,2}\b/);
  });

  it.each(pages)("%s 不含章节号与私有文档路径", (_name, text) => {
    expect(text).not.toContain("§");
    expect(text).not.toContain("私有文档");
  });
});
