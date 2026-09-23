/**
 * 脚手架防腐测试：模板是交付物，必须与引擎契约保持同构——
 * 模板故事能被文本投影器解析、清单合 ProjectManifest 契约、资源根配置与宿主接线不漂移。
 * 用 `?raw` 导入（不碰 fs：前端与核心层禁 Node，规约 00 §3.2）。
 */
import { describe, expect, it } from "vitest";
import projectJson from "./v1/__PROJECT__/Resources/project.json?raw";
import viteConfig from "./v1/__PROJECT__/vite.config.ts?raw";
import mainTs from "./v1/__PROJECT__/src/main.ts?raw";
import templatePkg from "./v1/__PROJECT__/package.json?raw";
import storySource from "./v1/__PROJECT__/Resources/Stories/title/title_main.story?raw";
import type { ProjectManifest } from "@lingfan/engine";
import { parseStory, parseTextStory } from "@lingfan/engine";

describe("template/v1 脚手架防腐", () => {
  it("模板故事可被文本投影器解析，且入口列 = 清单 entry", () => {
    const story = parseTextStory(storySource, "title_main.story");
    const manifest = JSON.parse(projectJson) as ProjectManifest;
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.entry).toBe("title_main");
    expect(story.columns.map((c) => c.id)).toContain(manifest.entry);
    // 占位符必须原样保留（生成时整体替换）
    expect(manifest.id).toBe("__PROJECT__");
  });

  it("清单合 ProjectManifest 契约（组装器可接受）", () => {
    const manifest = JSON.parse(projectJson) as ProjectManifest;
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: manifest.id,
        entry: manifest.entry,
        columns: [
          {
            id: manifest.entry,
            kind: "flow",
            commands: [{ op: "say", text: "x" }],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("资源根即静态根：publicDir 指向 Resources（08-U7 不依赖 CWD）", () => {
    expect(viteConfig).toContain('publicDir: "Resources"');
  });

  it("清单位于资源根内：dev 与打包产物同机制（防「dev 能取、prod 404」）", () => {
    // 本用例的 ?raw 导入路径即断言：project.json 必须在 Resources/ 内。
    // publicDir = Resources → 只有资源根内的文件会进打包产物；清单若留在项目根，
    // dev 下 Vite 顺带服务根目录能取到，但 dist/ 里没有 → 生产环境 404。
    const manifest = JSON.parse(projectJson) as ProjectManifest;
    expect(manifest.entry).toBe("title_main");
    expect(mainTs).toContain('"project.json"');
  });

  it("宿主按契约接线：三端口 + 订阅渲染 + 帧循环 + 输入映射", () => {
    for (const token of [
      "@lingfan/engine",
      "@lingfan/adapters",
      "@lingfan/ui",
      "loadProjectFromFetch",
      "onStateChanged",
      "requestAnimationFrame",
      "createStaticResourcePort",
      "createAudioRenderer",
    ]) {
      expect(mainTs).toContain(token);
    }
    // 宿主不得直接 import UI 框架（模板宿主是「框架无关」的活证明）
    expect(mainTs).not.toMatch(/from "(vue|react|@vue\/)/);
  });

  it("模板声明引擎三包依赖（发布形态正确）", () => {
    const pkg = JSON.parse(templatePkg) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(
      expect.arrayContaining([
        "@lingfan/engine",
        "@lingfan/adapters",
        "@lingfan/ui",
      ]),
    );
  });
});
