/**
 * 叠加层防腐测试：叠加层是生成器的事实素材，它与骨架的互锁关系必须是机器可验的。
 *
 * 叠加层分两类，判据不同：
 * - 换页面结构（框架层与小程序壳）：重写 index.html 与组合根，因此页面节点 id 必须覆盖骨架 `must()`；
 * - 加能力（桌面壳）：只往工程里补 src-tauri 与清单补丁，页面仍是骨架那份，因此不查节点 id。
 *
 * 四件事必须成立，否则生成出来的工程会在启动时炸在用户面前：
 * 1. 每个声明过的层目录真实存在（声明了就必须有素材），且都能给清单打补丁；
 * 2. 换页面结构的层，其节点 id 覆盖骨架组合根 `must()` 要的全部节点（缺一个就当场抛）；
 * 3. 叠加层不得偷偷改掉骨架的交付形态（资源根 `publicDir: "Resources"`、不含壳侧开关）；
 * 4. 叠加层不得自带宿主实现（装配与交互仍归骨架 `src/host/**`）。
 *
 * 用 `?raw` / `import.meta.glob` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
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
  "../../template/v1/overlays/**/*.{ts,tsx,vue,html,json}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 组合根文件名：各框架的语言后缀不同，判据按「入口名」而不是「后缀」认 */
const ENTRY_NAMES = ["src/main.ts", "src/main.tsx"];

/** 视图文件名：页面结构所在的文件，节点 id 从这里取 */
const VIEW_NAMES = ["App.vue", "App.tsx"];

/**
 * 不换页面结构的层：它们只补工程外围（如桌面壳的 `src-tauri/`），
 * 页面与 `index.html` 仍是骨架那一份，因此层里没有自己的 `index.html`。
 * 它们可以有组合根（换掉个别端口），但节点表必须与骨架同源。
 */
const PERIPHERAL_OPTIONS = new Set(["tauri"]);

/** 骨架组合根要的节点 id 表（与 `src/main.ts` 的 `must("#x")` 同源） */
function mustedIds(): string[] {
  return [
    ...skeletonMain.matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g),
  ].map((m) => m[1]!);
}

/** 从任意组合根源码里取 `must("#x")` 的节点 id 表 */
function takenIds(source: string): string[] {
  return [...source.matchAll(/must(?:<[^>]*>)?\(\s*"#([\w-]+)"\s*\)/g)].map(
    (m) => m[1]!,
  );
}

/** 某叠加层目录下的全部文本 */
function overlayFiles(optionId: string): [string, string][] {
  const prefix = `../../template/v1/overlays/${optionId}/`;
  return Object.keys(OVERLAY_SOURCES)
    .filter((path) => path.startsWith(prefix))
    .sort()
    .map((path) => [path, OVERLAY_SOURCES[path] ?? ""]);
}

/** 某叠加层里按入口/视图文件名找到的那份源码 */
function overlaySource(optionId: string, names: readonly string[]): string {
  const hit = overlayFiles(optionId).find(([path]) =>
    names.some((name) => path.endsWith(`/${name}`)),
  );
  return hit?.[1] ?? "";
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
      if (PERIPHERAL_OPTIONS.has(option.id)) continue;
      expect(files.some(([path]) => path.endsWith("index.html"))).toBe(true);
      expect(
        files.some(([path]) =>
          ENTRY_NAMES.some((name) => path.endsWith(`/${name}`)),
        ),
        `${option.id} 层缺组合根（${ENTRY_NAMES.join(" 或 ")}）`,
      ).toBe(true);
    }
  });

  it("有目录的层都靠清单补丁接入：不能只丢文件不声明依赖与脚本", () => {
    // 生成器只认层根的 package.patch.json（深合并进产物 package.json）；
    // 没有它，层里的文件就是到不了位的死素材。
    for (const option of [...(meta.frameworks ?? []), ...(meta.shells ?? [])]) {
      if (overlayFiles(option.id).length === 0) continue;
      expect(
        overlayFiles(option.id).some(([path]) =>
          path.endsWith("/package.patch.json"),
        ),
        `${option.id} 层缺 package.patch.json`,
      ).toBe(true);
    }
  });

  it("每层的占位符写法与骨架同源（工程名只认两套形态）", () => {
    // 带点/不带点的两套占位符由生成器统一替换；层里必须照抄，不能自创
    expect(skeletonHtml).toContain("__PROJECT__");
    for (const option of [...(meta.frameworks ?? []), ...(meta.shells ?? [])]) {
      for (const [path, source] of overlayFiles(option.id)) {
        if (!path.endsWith("index.html")) continue;
        expect(source, `${path} 丢了工程名占位符`).toContain("__PROJECT__");
      }
    }
  });

  it("只补工程外围的层登记在壳，不冒充框架（框架层必须自带页面结构）", () => {
    const frameworkIds = (meta.frameworks ?? []).map((option) => option.id);
    for (const optionId of PERIPHERAL_OPTIONS) {
      expect(
        frameworkIds,
        `${optionId} 不换页面结构，不能登记成框架层`,
      ).not.toContain(optionId);
    }
  });
});

describe("模板叠加层：页面节点覆盖组合根的全部 must()", () => {
  /**
   * 节点互锁只对「自己重画页面结构」且「用骨架那套 `must("#x")` 取节点」的层成立：
   * - 小程序壳自带整套页面与组件，入口是 `createSSRApp`，不经 `must()` 取节点，按证据筛掉；
   * - 桌面壳（`PERIPHERAL_OPTIONS`）也用 `must()` 取节点，但页面结构仍是骨架那份、
   *   层里没有自己的视图文件，节点 id 由骨架 `index.html` 提供，故不参与本组。
   */
  const interlocked = [...(meta.frameworks ?? []), ...(meta.shells ?? [])]
    .filter((option) => {
      if (PERIPHERAL_OPTIONS.has(option.id)) return false;
      const entry = overlaySource(option.id, ENTRY_NAMES);
      return entry.includes("must(");
    })
    .map((option) => [option.id] as const);

  it("至少有一层用 must() 取节点（防判据因筛空而空跑）", () => {
    expect(interlocked.length).toBeGreaterThan(0);
  });

  it.each(interlocked)("%s 层的视图渲染出骨架要求的每一个节点", (optionId) => {
    const view = overlaySource(optionId, VIEW_NAMES);
    expect(view, `${optionId} 层缺视图文件`).not.toBe("");
    const rendered = new Set(
      [...view.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]!),
    );
    const required = mustedIds();
    expect(required.length).toBeGreaterThan(4); // 防提取失效空跑
    for (const id of required) {
      expect(rendered.has(id), `${optionId} 视图缺 #${id}`).toBe(true);
    }
  });

  it.each(interlocked)(
    "%s 层组合根与骨架组合根取的是同一批节点",
    (optionId) => {
      const entry = overlaySource(optionId, ENTRY_NAMES);
      expect(takenIds(entry).sort()).toEqual(mustedIds().sort());
    },
  );
});

describe("模板叠加层：桌面壳只换端口，不重画页面", () => {
  it("桌面壳层不带 index.html（页面结构仍来自骨架）", () => {
    for (const optionId of PERIPHERAL_OPTIONS) {
      if (overlayFiles(optionId).length === 0) continue;
      expect(
        overlayFiles(optionId).some(([path]) => path.endsWith("index.html")),
        `${optionId} 层不应自带 index.html`,
      ).toBe(false);
    }
  });

  it("桌面壳层的组合根与骨架组合根取的是同一批节点", () => {
    // 壳层没有自己的视图文件，节点由骨架的 index.html 提供；
    // 只要它仍用 must() 取节点，取的就必须是同一批——多一个、少一个都会在启动时抛。
    for (const optionId of PERIPHERAL_OPTIONS) {
      const entry = overlaySource(optionId, ENTRY_NAMES);
      if (!entry.includes("must(")) continue;
      expect(
        takenIds(entry).sort(),
        `${optionId} 层节点表与骨架不一致`,
      ).toEqual(mustedIds().sort());
    }
  });

  it("桌面壳层的组合根通过 ports 换端口，而不是自己重写装配", () => {
    const shellEntries = [...PERIPHERAL_OPTIONS]
      .map((optionId) => overlaySource(optionId, ENTRY_NAMES))
      .filter((source) => source !== "");
    for (const entry of shellEntries) {
      // 换平台形态的唯一合法口子是 BootPortOverrides：直接调 bootHost 传 ports
      expect(entry).toContain("bootHost(");
      expect(entry).toContain("ports:");
      // 装配顺序归骨架的 boot.ts，壳层不该自己 new StoryEngine
      expect(entry).not.toContain("new StoryEngine");
    }
  });

  it("清单补丁声明了桌面壳的运行时与命令行依赖", () => {
    for (const optionId of PERIPHERAL_OPTIONS) {
      const hit = overlayFiles(optionId).find(([path]) =>
        path.endsWith("/package.patch.json"),
      );
      if (hit === undefined) continue;
      const patch = JSON.parse(hit[1]) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(
        patch.dependencies?.["@tauri-apps/api"],
        `${optionId} 层缺运行时依赖`,
      ).toBeDefined();
      expect(
        patch.devDependencies?.["@tauri-apps/cli"],
        `${optionId} 层缺命令行依赖`,
      ).toBeDefined();
    }
  });
});

describe("模板叠加层：不得改动骨架的交付形态", () => {
  it("资源根仍是无条件镜像，且不引入壳侧开关（纯 Web 就是浏览器交付正例）", () => {
    const configs = Object.keys(OVERLAY_SOURCES).filter((path) =>
      path.endsWith("vite.config.ts"),
    );
    expect(configs.length).toBeGreaterThan(0);
    for (const path of configs) {
      const source = OVERLAY_SOURCES[path] ?? "";
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
    for (const option of [...(meta.frameworks ?? []), ...(meta.shells ?? [])]) {
      for (const [path] of overlayFiles(option.id)) {
        expect(path, `${path} 不应自带宿主实现`).not.toContain("/host/");
      }
    }
  });
});
