/**
 * 脚手架防腐测试：模板是交付物，必须与引擎契约保持同构——
 * 模板故事能被文本投影器解析、清单合 ProjectManifest 契约、资源根配置与宿主接线不漂移。
 * 用 `?raw` 导入（不碰 fs：前端与核心层禁 Node）。
 *
 * 宿主接线断言的扫描面 = 模板宿主全目录（新增文件自动纳入）：组合根只留节点解析与装配调用，
 * 端口、订阅、帧循环、输入映射都在 `host/**` 里；单文件锚点会随拆分失效，
 * 故按目录合成一份文本再断言。
 */
import { describe, expect, it } from "vitest";
import projectJson from "../../template/v1/__PROJECT__/Resources/project.json?raw";
import viteConfig from "../../template/v1/__PROJECT__/vite.config.ts?raw";
import indexHtml from "../../template/v1/__PROJECT__/index.html?raw";
import templatePkg from "../../template/v1/__PROJECT__/package.json?raw";
import storySource from "../../template/v1/overlays/story/Resources/Stories/manual/manual_intro.story?raw";
import skeletonStoryJson from "../../template/v1/__PROJECT__/Resources/Stories/title/title_main.json?raw";
import type { NameResolver, ProjectManifest } from "@lingfan-engine/core";
import {
  interpolateText,
  parseStory,
  parseTextStory,
} from "@lingfan-engine/core";

/** 模板宿主全部源码，键 = 仓库相对路径（前端不碰文件系统，改用打包器读取） */
const SRC_SOURCES = import.meta.glob(
  "../../template/v1/__PROJECT__/src/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 组合根与 `host/**` 合成一份文本：宿主接线断言按整目录判定 */
const srcText = Object.keys(SRC_SOURCES)
  .sort()
  .map((path) => SRC_SOURCES[path] ?? "")
  .join("\n");

/** 宿主断言用的 DOM id 表：`must("#x")` 与 index.html 的 `id="x"` 必须互锁 */
function mustedIds(): string[] {
  return [...srcText.matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g)].map(
    (m) => m[1]!,
  );
}

function htmlIds(): string[] {
  return [...indexHtml.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!);
}

describe("template/v1 脚手架防腐", () => {
  it("骨架自带编译好的故事产物，且入口列 = 清单 entry", () => {
    // 骨架缺省形态是 TS 源：`Resources/Stories/**/*.json` 是 `stories:build` 的产物，
    // 开箱即跑（`pnpm dev` 不必先构建）。手写 `.story` 由 `overlays/story/` 额外附一份示例，
    // 与这条产物并存——三种创作形态在同一棵树上混装。
    // 一个产物文件 = 一列，所以入口列只在本文件里；其余列各自成文件。
    const story = parseStory(JSON.parse(skeletonStoryJson));
    const manifest = JSON.parse(projectJson) as ProjectManifest;
    expect(story.columns.map((c) => c.id)).toEqual([manifest.entry]);
    expect(story.columns[0]?.id).toBe(manifest.entry);
  });

  it("手写示例可被文本投影器解析，列 id 落在自己的命名空间", () => {
    // 示例刻意不复用骨架的 `title_main` / `look_around`：列 id 全工程唯一是构建期
    // 硬约束，撞名会让生成出来的工程立刻 fail-closed。
    const story = parseTextStory(storySource, "manual_intro.story");
    const manifest = JSON.parse(projectJson) as ProjectManifest;
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.entry).toBe("title_main");
    const ids = story.columns.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id.startsWith("manual_"), `示例列 id 越界：${id}`).toBe(true);
    }
    expect(ids).not.toContain(manifest.entry);
    // 占位符必须原样保留（生成时整体替换）
    expect(manifest.id).toBe("__PROJECT__");
  });

  it("模板故事的全部文案都能过插值（回归：`{Audio,Images,Video}` 曾让首屏常挂红条）", () => {
    // 故事文本里的 `{…}` 一律按表达式解析，只有行内标记白名单例外——
    // 所以想表达「目录列举」不能借用花括号：`Resources/{Audio,Images,Video}`
    // 会抛 `parse-error: 表达式存在多余内容：','`，开局就在 `#error` 上挂一条常驻错误条。
    // 这里用「所有变量都命中」的解析器跑一遍，把解析错误与缺变量两种噪声分开：
    // 变量是否存在是作者工程的事，语法能不能过是模板的事。
    const alwaysFound: NameResolver = () => ({ found: true, value: "x" });
    const story = parseTextStory(storySource, "manual_intro.story");
    const texts: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(
        node as Record<string, unknown>,
      ))
        if (key === "text" && typeof value === "string") texts.push(value);
        else walk(value);
    };
    walk(story);
    expect(texts.length).toBeGreaterThan(3); // 防提取失效空跑
    for (const text of texts) {
      const { errors } = interpolateText(text, alwaysFound);
      expect(errors, `文案插值失败：${text}`).toEqual([]);
    }
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
    // 宿主按清单名去取：名字取引擎契约的 MANIFEST_FILE，不在此处重写一份字面量
    // （重写会让「改名」变成两处不同步，见 07 魔法值收口）。
    expect(srcText).toContain("MANIFEST_FILE");
    expect(srcText).not.toContain('"project.json"');
  });

  it("扫描面覆盖模板宿主全目录（文件数 ≥8 且含组合根与宿主叶子，防假绿）", () => {
    const paths = Object.keys(SRC_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(paths.some((path) => path.endsWith("/src/main.ts"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/host/stage-dom.ts"))).toBe(
      true,
    );
  });

  it("宿主按契约接线：端口 + 订阅渲染 + 帧循环 + 输入映射", () => {
    for (const token of [
      "@lingfan-engine/core",
      "@lingfan-engine/adapters",
      "@lingfan-engine/ui",
      "createFetchProjectFilesPort",
      "loadProject",
      "onStateChanged",
      "requestAnimationFrame",
      "createStaticResourcePort",
      "createAudioRenderer",
    ]) {
      expect(srcText).toContain(token);
    }
    // 宿主不得直接 import UI 框架（模板宿主是「框架无关」的活证明）
    expect(srcText).not.toMatch(/from "(vue|react|@vue\/)/);
  });

  it("宿主 must() 的每个 DOM id 都在 index.html 里存在（回归：宿主 ↔ 骨架互锁）", () => {
    const ids = mustedIds();
    expect(ids.length).toBeGreaterThan(4); // 防提取失效空跑
    const available = new Set(htmlIds());
    for (const id of ids) {
      expect(available.has(id), `index.html 缺 #${id}`).toBe(true);
    }
  });

  it("每个等待态都有可推进出口（回归：曾只有 dialogue，menu/input/video 会永久卡死）", () => {
    // 引擎能进入的等待态全集（WaitingState）都必须被宿主识别
    for (const state of [
      "dialog",
      "menu",
      "input",
      "wait",
      "video",
      "minigame",
    ]) {
      expect(srcText, `宿主未处理等待态 ${state}`).toContain(`"${state}"`);
    }
    // 三类推进出口：菜单选择 / 输入提交 / advance（含 wait·video 跳过）
    for (const call of [
      "engine.choose(",
      "engine.input(",
      "engine.advance()",
      "engine.videoFinished()",
      "engine.animationFinished(",
    ]) {
      expect(srcText, `宿主缺少推进出口 ${call}`).toContain(call);
    }
    // 未接注册表的小游戏等待必须**可见 fail-closed**（不静默停在等待）
    expect(srcText).toContain('"minigame.mount"');
    expect(srcText).toContain("engine.resolveMinigame");
  });

  it("工程配置被宿主消费（回归：shell.* 不得静默失效）", () => {
    expect(srcText).toContain("resolveLayerZ");
    expect(srcText).toContain("layerZ.");
    expect(srcText).toContain("resolveSavesConfig");
    expect(srcText).toContain("slotIds(saves.slots)");
    // window auto|show|hide 的消费点（曾是无宿主消费的死键）
    expect(srcText).toContain("SYS.dialogVisible");
    // 舞台元素层
    expect(srcText).toContain("renderElementTree");
    expect(srcText).toContain("SYS.elements");
  });

  it("模板宿主不用 ES2022 的 Array.prototype.at（旧 WebView 兼容性）", () => {
    expect(srcText).not.toMatch(/\.at\(/);
  });

  it("模板声明引擎四包依赖（发布形态正确）", () => {
    const pkg = JSON.parse(templatePkg) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(
      expect.arrayContaining([
        "@lingfan-engine/core",
        "@lingfan-engine/adapters",
        "@lingfan-engine/ui",
        // 历史面板的数据整形（块聚合）在 shell：宿主不自己再写一份聚合规则
        "@lingfan-engine/shell",
      ]),
    );
  });
});
