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
import skeletonManifest from "../../template/v1/__PROJECT__/package.json?raw";
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
  sources?: TemplateOption[];
};

/** 声明过的全部可选层：三个维度一起看，漏掉一维就等于那维没被验过 */
const ALL_OPTIONS = [
  ...(meta.frameworks ?? []),
  ...(meta.sources ?? []),
  ...(meta.shells ?? []),
];

/**
 * 可以没有叠加层目录的形态：它们的产物**就是骨架本身**，没有任何一行差异。
 *
 * 判据按「该层是否真的改变产物」而不是按排序位置认——缺省项换个顺序
 * （比如故事源缺省从 `story` 改成 `ts`），不改变「零改动形态无需目录」这件事。
 */
const NO_DIRECTORY_OPTIONS = new Set(["none", "story", "browser"]);

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
 * 不换页面结构的层：它们只补工程外围，页面与 `index.html` 仍是骨架那一份，
 * 因此层里没有自己的 `index.html`。
 * 它们可以有组合根（换掉个别端口），但节点表必须与骨架同源。
 *
 * - `tauri`：只补 `src-tauri/` 与清单补丁；
 * - `ts`：故事源形态层，只把 `Resources/Stories/**` 换成 TS 编译链的产物，
 *   页面与装配一行不动。
 */
const PERIPHERAL_OPTIONS = new Set(["tauri", "ts"]);

/** 外围层里带原生平台桥的那一类：只有它们该声明平台依赖与命令行 */
const DESKTOP_SHELL_OPTIONS = new Set(["tauri"]);

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
    expect(ALL_OPTIONS.length).toBeGreaterThan(0);
    for (const option of ALL_OPTIONS) {
      const files = overlayFiles(option.id);
      // 缺省项可以没有目录：骨架本身就是它的形态（原生框架 / 故事文件 / 浏览器壳）
      if (files.length === 0) {
        expect(
          NO_DIRECTORY_OPTIONS.has(option.id),
          `零改动形态之外的层必须有目录：${option.id}`,
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
    for (const option of ALL_OPTIONS) {
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
    for (const option of ALL_OPTIONS) {
      for (const [path, source] of overlayFiles(option.id)) {
        if (!path.endsWith("index.html")) continue;
        expect(source, `${path} 丢了工程名占位符`).toContain("__PROJECT__");
      }
    }
  });

  it("只补工程外围的层登记在壳或故事源，不冒充框架（框架层必须自带页面结构）", () => {
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
   * - 外围层（`PERIPHERAL_OPTIONS`）不重画页面，节点 id 由骨架 `index.html` 提供，
   *   故不参与本组。
   */
  const interlocked = ALL_OPTIONS.filter((option) => {
    if (PERIPHERAL_OPTIONS.has(option.id)) return false;
    const entry = overlaySource(option.id, ENTRY_NAMES);
    return entry.includes("must(");
  }).map((option) => [option.id] as const);

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

describe("模板叠加层：外围层只换端口与素材，不重画页面", () => {
  it("外围层不带 index.html（页面结构仍来自骨架）", () => {
    for (const optionId of PERIPHERAL_OPTIONS) {
      if (overlayFiles(optionId).length === 0) continue;
      expect(
        overlayFiles(optionId).some(([path]) => path.endsWith("index.html")),
        `${optionId} 层不应自带 index.html`,
      ).toBe(false);
    }
  });

  it("外围层的组合根与骨架组合根取的是同一批节点", () => {
    // 外围层没有自己的视图文件，节点由骨架的 index.html 提供；
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

  it("外围层若自带组合根，只通过 ports 换端口，不重写装配", () => {
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

  it("桌面壳的清单补丁声明了运行时与命令行依赖", () => {
    for (const optionId of DESKTOP_SHELL_OPTIONS) {
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

describe("模板叠加层：类型声明文件不得因覆盖而丢模块", () => {
  /**
   * 骨架的 `src/vite-env.d.ts` 是**整文件覆盖**而非合并：层里再放一份同名文件，
   * 骨架那份就整个消失。曾经 vue / react 两层各补一份（为了 `.vue` / JSX 声明），
   * 顺手把骨架的 `virtual:story-list` 一起丢了 —— 生成工程必然 `TS2307`，
   * 而这是纯类型层缺陷，`vite dev` 照样能跑，只有 `typecheck` 会红。
   *
   * 判据：层里带 `src/vite-env.d.ts` 的，必须声明骨架那份声明过的全部虚拟模块。
   */
  const DECL_SOURCE = "../../template/v1/__PROJECT__/src/vite-env.d.ts";

  /** 从声明文件里取出 `declare module "x"` 的模块 id 表 */
  function declaredModules(source: string): string[] {
    return [...source.matchAll(/declare module "([^"]+)"/g)].map((m) => m[1]!);
  }

  const skeletonDecl = (
    import.meta.glob("../../template/v1/__PROJECT__/src/vite-env.d.ts", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>
  )[DECL_SOURCE];

  /** 自带同名声明文件的层 */
  const overriddenDecls = Object.keys(OVERLAY_SOURCES)
    .filter((path) => path.endsWith("/src/vite-env.d.ts"))
    .sort();

  it("骨架声明文件可被读取且确实声明了虚拟模块（防判据空跑）", () => {
    expect(skeletonDecl).toBeDefined();
    expect(declaredModules(skeletonDecl!).length).toBeGreaterThan(0);
  });

  it("覆盖骨架声明文件的层，必须把骨架的虚拟模块声明原样带上", () => {
    const required = declaredModules(skeletonDecl!);
    expect(overriddenDecls.length).toBeGreaterThan(0); // 当前 vue / react 两层会命中
    for (const path of overriddenDecls) {
      const declared = new Set(declaredModules(OVERLAY_SOURCES[path] ?? ""));
      for (const moduleId of required) {
        expect(
          declared.has(moduleId),
          `${path} 漏声明了 ${moduleId}（覆盖骨架声明文件时必须原样带上）`,
        ).toBe(true);
      }
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
    for (const option of ALL_OPTIONS) {
      for (const [path] of overlayFiles(option.id)) {
        expect(path, `${path} 不应自带宿主实现`).not.toContain("/host/");
      }
    }
  });
});

describe("模板叠加层：故事源形态层只换故事素材", () => {
  const TS_FILES = overlayFiles("ts");

  it("ts 层自带构建脚本，开箱就能跑 stories:build", () => {
    const patch = TS_FILES.find(([path]) =>
      path.endsWith("/package.patch.json"),
    );
    expect(patch, "ts 层缺 package.patch.json").toBeDefined();
    const parsed = JSON.parse(patch![1]) as {
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    // 构建链是层内自带的：消费工程不该再自己装包、自己拼命令
    expect(parsed.devDependencies?.["@lingfan-engine/editor"]).toBeDefined();
    for (const script of ["stories:build", "stories:watch"]) {
      expect(parsed.scripts?.[script], `ts 层缺 ${script} 脚本`).toBeDefined();
    }
  });

  it("构建期依赖只在骨架声明一次，层里不重复", () => {
    // 骨架的 `vite.plugins.ts` 引 `@lingfan-engine/stories-build/host-plugins`，
    // 所以骨架自己就得声明它；ts 层的构建命令用的也是同一个包。
    // 两层各写一份版本号，升级时必然漏改一处——同一依赖只留骨架那处。
    const skeleton = JSON.parse(skeletonManifest) as {
      dependencies?: Record<string, string>;
    };
    expect(
      skeleton.dependencies?.["@lingfan-engine/stories-build"],
      "骨架必须声明 stories-build：它的 vite.plugins.ts 直接引该包",
    ).toBeDefined();
    for (const [path, source] of TS_FILES) {
      if (!path.endsWith("/package.patch.json")) continue;
      const parsed = JSON.parse(source) as {
        devDependencies?: Record<string, string>;
      };
      expect(
        parsed.devDependencies?.["@lingfan-engine/stories-build"],
        `${path} 重复声明了 stories-build`,
      ).toBeUndefined();
    }
  });

  it("ts 层用生成物接管故事目录：骨架那份手写故事必须先被删掉", () => {
    // 产物由 stories:build 全量管理 Stories/**：留着骨架的 .story，
    // 第一次构建就会把它当陈旧列删掉，使用者会以为文件「自己消失了」。
    const patch = TS_FILES.find(([path]) =>
      path.endsWith("/package.patch.json"),
    );
    const parsed = JSON.parse(patch![1]) as { create?: { remove?: string[] } };
    expect(parsed.create?.remove).toContain("Resources/Stories");
    // 删除之后必须补上生成物，否则工程开箱没有任何可跑的故事
    expect(
      TS_FILES.some(([path]) => path.endsWith("Resources/project.json")),
      "ts 层缺 Resources/project.json",
    ).toBe(true);
    expect(
      TS_FILES.filter(([path]) => path.endsWith(".json")).length,
      "ts 层缺故事生成物",
    ).toBeGreaterThan(1);
  });

  it("ts 层不覆盖故事表：清单由构建期扫描资源根得出，与创作形态无关", () => {
    // 手写产物名单会让「加了列却忘了登记」在构建期无声通过、运行期才 unknown-column，
    // 所以清单是磁盘事实的投影（骨架 vite.plugins.ts 的 virtual:story-list）。
    // 创作形态只决定产物从哪来，不该再长出一个需要同步的第二事实来源。
    expect(
      TS_FILES.some(([path]) => path.endsWith("/src/stories.ts")),
      "ts 层不应带自己的 src/stories.ts",
    ).toBe(false);
  });
});
