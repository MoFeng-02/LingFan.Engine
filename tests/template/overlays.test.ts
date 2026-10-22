/**
 * 框架叠加层防腐测试：叠加层是生成器的事实素材，它与骨架的互锁关系必须是机器可验的。
 *
 * 三件事必须成立，否则生成出来的工程会在启动时炸在用户面前：
 * 1. 每个在 `template-meta.json` 里声明过的框架层，目录真实存在（声明了就必须有素材）；
 * 2. 叠加层写出的页面节点 id 覆盖骨架组合根 `must()` 要的全部节点（缺一个就当场抛）；
 * 3. 叠加层不得偷偷改掉骨架的交付形态（资源根 `publicDir: "Resources"`、不含壳侧开关）。
 *
 * 用 `?raw` / `globby` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import templateMeta from "../../template/v1/template-meta.json?raw";
import skeletonMain from "../../template/v1/__PROJECT__/src/main.ts?raw";
import skeletonHtml from "../../template/v1/__PROJECT__/index.html?raw";

/** `template-meta.json` 里声明的可选层 */
interface TemplateOption {
  id: string;
  label: string;
  hint: string;
}

const meta = JSON.parse(templateMeta) as {
  frameworks?: TemplateOption[];
  shells?: TemplateOption[];
};

/** 叠加层全部文本，键 = 仓库相对路径 */
const OVERLAY_SOURCES = import.meta.glob(
  "../../template/v1/overlays/**/*.{ts,vue,html,json}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 骨架组合根要的节点 id 表（与 `src/main.ts` 的 `must("#x")` 同源） */
function mustedIds(): string[] {
  return [
    ...skeletonMain.matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g),
  ].map((m) => m[1]!);
}

/** 某叠加层目录下的全部文本 */
function overlayFiles(optionId: string): [string, string][] {
  const prefix = `../../template/v1/overlays/${optionId}/`;
  return Object.keys(OVERLAY_SOURCES)
    .filter((path) => path.startsWith(prefix))
    .sort()
    .map((path) => [path, OVERLAY_SOURCES[path] ?? ""]);
}

describe("模板叠加层：声明与素材一致", () => {
  it("声明过的每个层都有目录，且每层至少含一份入口文件", () => {
    const options = [...(meta.frameworks ?? []), ...(meta.shells ?? [])];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      const files = overlayFiles(option.id);
      // 首项是缺省值，可以没有目录：骨架本身就是它的形态（原生框架 / 浏览器壳）
      if (files.length === 0) {
        expect(
          (meta.frameworks ?? [])[0]?.id === option.id ||
            (meta.shells ?? [])[0]?.id === option.id,
          `首项之外的层必须有目录：${option.id}`,
        ).toBe(true);
        continue;
      }
      expect(files.some(([path]) => path.endsWith("index.html"))).toBe(true);
      expect(files.some(([path]) => path.endsWith("src/main.ts"))).toBe(true);
    }
  });

  it("每层的占位符写法与骨架同源（工程名只认两套形态）", () => {
    // 带点/不带点的两套占位符由生成器统一替换；层里必须照抄，不能自创
    expect(skeletonHtml).toContain("__PROJECT__");
    for (const option of meta.frameworks ?? []) {
      for (const [path, source] of overlayFiles(option.id)) {
        if (!path.endsWith("index.html")) continue;
        expect(source, `${path} 丢了工程名占位符`).toContain("__PROJECT__");
      }
    }
  });
});

describe("模板叠加层：页面节点覆盖组合根的全部 must()", () => {
  it("Vue 层的 App.vue 渲染出骨架要求的每一个节点", () => {
    const appSource = overlayFiles("vue").find(([path]) =>
      path.endsWith("App.vue"),
    );
    expect(appSource).toBeDefined();
    const rendered = new Set(
      [...(appSource?.[1] ?? "").matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!),
    );
    const required = mustedIds();
    expect(required.length).toBeGreaterThan(4); // 防提取失效空跑
    for (const id of required) {
      expect(rendered.has(id), `App.vue 缺 #${id}`).toBe(true);
    }
  });

  it("Vue 层组合根与骨架组合根取的是同一批节点", () => {
    const mainSource = overlayFiles("vue").find(([path]) =>
      path.endsWith("src/main.ts"),
    )?.[1];
    expect(mainSource).toBeDefined();
    const taken = [
      ...(mainSource ?? "").matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g),
    ].map((m) => m[1]!);
    expect(taken.sort()).toEqual(mustedIds().sort());
  });
});

describe("模板叠加层：不得改动骨架的交付形态", () => {
  it("资源根仍是无条件镜像，且不引入壳侧开关（纯 Web 就是浏览器交付正例）", () => {
    for (const [path, source] of overlayFiles("vue")) {
      if (!path.endsWith("vite.config.ts")) continue;
      expect(source, `${path} 必须保留资源根`).toContain(
        'publicDir: "Resources"',
      );
      expect(source, `${path} 不得引入壳侧开关`).not.toContain(
        "VITE_LFEN_BROWSER_GAME",
      );
    }
  });

  it("页面结构只在视图文件里，宿主层一行未改（换框架不动装配）", () => {
    // 叠加层不得自带 host/：装配与交互仍由骨架的 src/host/** 负责
    for (const option of meta.frameworks ?? []) {
      for (const [path] of overlayFiles(option.id)) {
        expect(path, `${path} 不应自带宿主实现`).not.toContain("/host/");
      }
    }
  });
});
