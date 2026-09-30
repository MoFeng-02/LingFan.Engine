/**
 * 脚手架防腐测试：模板是交付物，必须与引擎契约保持同构——
 * 模板故事能被文本投影器解析、清单合 ProjectManifest 契约、资源根配置与宿主接线不漂移。
 * 用 `?raw` 导入（不碰 fs：前端与核心层禁 Node）。
 */
import { describe, expect, it } from "vitest";
import projectJson from "../../template/v1/__PROJECT__/Resources/project.json?raw";
import viteConfig from "../../template/v1/__PROJECT__/vite.config.ts?raw";
import mainTs from "../../template/v1/__PROJECT__/src/main.ts?raw";
import indexHtml from "../../template/v1/__PROJECT__/index.html?raw";
import templatePkg from "../../template/v1/__PROJECT__/package.json?raw";
import storySource from "../../template/v1/__PROJECT__/Resources/Stories/title/title_main.story?raw";
import type { ProjectManifest } from "@lingfan/engine";
import { parseStory, parseTextStory } from "@lingfan/engine";

/** 宿主断言用的 DOM id 表：`must("#x")` 与 index.html 的 `id="x"` 必须互锁 */
function mustedIds(): string[] {
  return [...mainTs.matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g)].map(
    (m) => m[1]!,
  );
}

function htmlIds(): string[] {
  return [...indexHtml.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!);
}

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

  it("资源根即静态根：publicDir 指向 Resources（不依赖 CWD）", () => {
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

  it("宿主按契约接线：端口 + 订阅渲染 + 帧循环 + 输入映射", () => {
    for (const token of [
      "@lingfan/engine",
      "@lingfan/adapters",
      "@lingfan/ui",
      "createFetchProjectFilesPort",
      "loadProject",
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

  it("宿主 must() 的每个 DOM id 都在 index.html 里存在（回归锚定：宿主 ↔ 骨架互锁）", () => {
    const ids = mustedIds();
    expect(ids.length).toBeGreaterThan(4); // 防提取失效空跑
    const available = new Set(htmlIds());
    for (const id of ids) {
      expect(available.has(id), `index.html 缺 #${id}`).toBe(true);
    }
  });

  it("每个等待态都有可推进出口（回归锚定：曾只有 dialogue，menu/input/video 会永久卡死）", () => {
    // 引擎能进入的等待态全集（WaitingState）都必须被宿主识别
    for (const state of ["dialog", "menu", "input", "wait", "video", "minigame"]) {
      expect(mainTs, `宿主未处理等待态 ${state}`).toContain(`"${state}"`);
    }
    // 三类推进出口：菜单选择 / 输入提交 / advance（含 wait·video 跳过）
    for (const call of [
      "engine.choose(",
      "engine.input(",
      "engine.advance()",
      "engine.videoFinished()",
      "engine.animationFinished(",
    ]) {
      expect(mainTs, `宿主缺少推进出口 ${call}`).toContain(call);
    }
    // 未接注册表的小游戏等待必须**可见 fail-closed**（不静默停在等待）
    expect(mainTs).toContain('"minigame.mount"');
    expect(mainTs).toContain("engine.resolveMinigame");
  });

  it("工程配置被宿主消费（回归锚定：shell.* 不得静默失效）", () => {
    expect(mainTs).toContain("resolveLayerZ");
    expect(mainTs).toContain("layerZ.");
    expect(mainTs).toContain("resolveSavesConfig");
    expect(mainTs).toContain("slotIds(saves.slots)");
    // window auto|show|hide 的消费点（曾是无宿主消费的死键）
    expect(mainTs).toContain("SYS.dialogVisible");
    // 舞台元素层
    expect(mainTs).toContain("renderElementTree");
    expect(mainTs).toContain("SYS.elements");
  });

  it("模板宿主不用 ES2022 的 Array.prototype.at（旧 WebView 兼容纪律）", () => {
    expect(mainTs).not.toMatch(/\.at\(/);
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
