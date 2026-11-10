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
import skeletonStoriesConfig from "../../template/v1/__PROJECT__/src/Stories.src/config.ts?raw";
import skeletonStoriesTsconfig from "../../template/v1/__PROJECT__/tsconfig.stories.json?raw";
import skeletonStoryJson from "../../template/v1/__PROJECT__/Resources/Stories/title/title_main.json?raw";
import {
  imageModeOf,
  toMiniNode,
} from "../../template/v1/overlays/miniprogram/src/mp/view.ts";

/** `template-meta.json` 里声明的可选层 */
interface TemplateOption {
  id: string;
  label: string;
  hint: string;
  /** 与本层不能共存的层 id；缺省表示不排斥任何层 */
  excludes?: string[];
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
 *
 * 故事源缺省是 `ts`：骨架自带整条 TS 创作链，所以 `ts` 是零改动形态；
 * 反过来 `story` 有目录，但它的目录只额外附一份手写示例，不摘任何骨架文件
 * （三种创作形态共存于同一棵 `Resources/Stories/` 树）。
 */
const NO_DIRECTORY_OPTIONS = new Set(["none", "ts", "browser"]);

/** 叠加层全部文本，键 = 仓库相对路径 */
const OVERLAY_SOURCES = import.meta.glob(
  "../../template/v1/overlays/**/*.{ts,tsx,vue,html,json,story}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 骨架全部文本：用来校验叠加层的 `create.remove` 只点名真实存在的骨架路径 */
const SKELETON_SOURCES = import.meta.glob(
  "../../template/v1/__PROJECT__/**/*.{ts,tsx,vue,html,json,story}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 骨架路径表，键去掉了 `../../template/v1/__PROJECT__/` 前缀 */
const SKELETON_PATHS = Object.keys(SKELETON_SOURCES)
  .map((path) => path.slice("../../template/v1/__PROJECT__/".length))
  .sort();

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
 * - `story`：只额外附一份手写 `.story` 示例，与骨架的 TS 创作链并存，
 *   页面、装配、故事目录一行不动。
 */
const PERIPHERAL_OPTIONS = new Set(["tauri", "story"]);

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

  it("**外围壳层不自带组合根**：入口与页面结构永远归属框架层", () => {
    // 壳层自带组合根时，它覆盖的是框架层的同名文件：`-f vue` / `-f react` 的
    // index.html 只有 #app，而壳层组合根按骨架的 15 个节点取——启动当场抛。
    // 桥的装配下沉到骨架的 src/host/，由各形态组合根统一调用。
    for (const optionId of DESKTOP_SHELL_OPTIONS) {
      const entries = overlayFiles(optionId)
        .map(([path]) => path)
        .filter((path) => ENTRY_NAMES.some((name) => path === name));
      expect(entries, `${optionId} 层不应自带组合根`).toEqual([]);
    }
  });

  it("桌面壳的清单补丁只声明命令行依赖，运行时依赖在骨架（各形态都装）", () => {
    // `@tauri-apps/api` 的模块名出现在骨架的 `src/host/`（原生端口装配），
    // 而骨架每个形态都要能独立装起来 —— 所以它必须声明在骨架清单里，
    // 不能挂在壳层增量上（否则 `-s browser` 的工程 typecheck 就找不到模块）。
    const skeletonPkg = JSON.parse(skeletonManifest) as {
      dependencies?: Record<string, string>;
    };
    expect(
      skeletonPkg.dependencies?.["@tauri-apps/api"],
      "骨架清单缺 @tauri-apps/api（原生端口装配要用）",
    ).toBeDefined();
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

describe("模板叠加层：TS 创作链归骨架，故事文件示例只做加法", () => {
  const STORY_FILES = overlayFiles("story");
  const skeletonPkg = JSON.parse(skeletonManifest) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("骨架自带三条创作脚本与创作期依赖，开箱就能跑 stories:build", () => {
    // 缺省形态是 TypeScript 源：整条链必须在骨架里，消费工程不该再自己装包、自己拼命令
    for (const script of [
      "stories:build",
      "stories:watch",
      "stories-typecheck",
    ]) {
      expect(
        skeletonPkg.scripts?.[script],
        `骨架缺 ${script} 脚本`,
      ).toBeDefined();
    }
    expect(
      skeletonPkg.devDependencies?.["@lingfan-engine/editor"],
      "骨架缺创作期依赖 editor（故事列的类型补全来自它）",
    ).toBeDefined();
    // 骨架的 `vite.plugins.ts` 引 `@lingfan-engine/stories-build/host-plugins`，
    // 所以它落在 dependencies 而不是 devDependencies。
    expect(
      skeletonPkg.dependencies?.["@lingfan-engine/stories-build"],
      "骨架必须声明 stories-build：它的 vite.plugins.ts 直接引该包",
    ).toBeDefined();
  });

  it("骨架自带整条 TS 创作链：源 + 生成物声明 + 独立类型检查工程 + 开箱产物", () => {
    expect(skeletonStoriesConfig, "骨架缺 src/Stories.src/config.ts").toContain(
      "defineVars",
    );
    // 四份 .gen.d.ts 是 ambient 全局：列名注册表、插值键、script/font、StoryState
    for (const name of ["font", "script", "state", "stories"]) {
      expect(
        SKELETON_PATHS.includes(`src/gen/${name}.gen.d.ts`),
        `骨架缺 src/gen/${name}.gen.d.ts`,
      ).toBe(true);
    }
    // 故事源是独立 TS 工程：根 tsconfig 由框架/壳层决定，故事源只吃纯 tsc
    expect(skeletonStoriesTsconfig, "骨架缺 tsconfig.stories.json").toContain(
      "src/Stories.src",
    );
    // 开箱产物：构建前就能跑，否则生成出来的工程首屏没有故事
    const produced = JSON.parse(skeletonStoryJson) as {
      id?: string;
      kind?: string;
    };
    expect(produced.id).toBe("title_main");
    expect(produced.kind).toBe("flow");
  });

  it("story 层只做加法：不删文件、不改清单", () => {
    // 三种创作形态（TS 源 / 手写 .story / 手写 .json）是同一棵 Resources/Stories/
    // 树上的不同文件形态，可以共存。所以这一层只额外附一份手写示例，
    // 既不该删骨架的 TS 创作链，也不该从清单里摘掉脚本或依赖。
    const patch = STORY_FILES.find(([path]) =>
      path.endsWith("/package.patch.json"),
    );
    expect(patch, "story 层缺 package.patch.json").toBeDefined();
    const parsed = JSON.parse(patch![1] || "{}") as {
      create?: { remove?: string[]; unset?: Record<string, string[]> };
      devDependencies?: Record<string, string>;
    };
    expect(
      parsed.create?.remove,
      "story 层不该删除任何骨架文件",
    ).toBeUndefined();
    expect(
      parsed.create?.unset,
      "story 层不该摘掉骨架的脚本或依赖",
    ).toBeUndefined();
    // 构建期依赖只归骨架：层里再写一份版本号，升级时必然漏改一处
    expect(
      parsed.devDependencies?.["@lingfan-engine/stories-build"],
      "story 层不该声明 stories-build",
    ).toBeUndefined();
    // 加法必须真的加了东西：这一层存在就是为了给出一份可读可改的手写示例
    const examples = STORY_FILES.filter(([path]) => path.endsWith(".story"));
    expect(examples.length, "story 层缺手写示例").toBeGreaterThan(0);
  });

  it("手写示例的列 id 不与骨架产物撞名：全工程列 id 唯一是构建期硬约束", () => {
    // 撞名的后果是构建期 fail-closed（columnId 重复），使用者会以为模板坏了。
    // 判据取两侧磁盘事实：骨架 Resources/Stories/**/*.json 的 id 与示例列头声明的 id。
    const skeletonIds = new Set<string>();
    for (const [path, source] of Object.entries(SKELETON_SOURCES)) {
      if (!path.includes("/Resources/Stories/") || !path.endsWith(".json")) {
        continue;
      }
      const parsed = JSON.parse(source) as { id?: string };
      if (typeof parsed.id === "string") {
        skeletonIds.add(parsed.id);
      }
    }
    expect(skeletonIds.size, "骨架没有故事列，判据失效").toBeGreaterThan(0);

    const exampleIds = new Set<string>();
    for (const [path, source] of STORY_FILES) {
      if (!path.endsWith(".story")) {
        continue;
      }
      for (const match of source.matchAll(/^(?:scene|label)\s+([\w-]+)/gm)) {
        exampleIds.add(match[1]!);
      }
    }
    expect(exampleIds.size, "示例没有声明任何列，判据失效").toBeGreaterThan(0);

    const overlap = [...exampleIds].filter((id) => skeletonIds.has(id));
    expect(
      overlap,
      `手写示例与骨架的列 id 撞名：${overlap.join("、")}`,
    ).toEqual([]);
  });

  it("story 层不覆盖故事表：清单由构建期扫描资源根得出，与创作形态无关", () => {
    // 手写产物名单会让「加了列却忘了登记」在构建期无声通过、运行期才 unknown-column，
    // 所以清单是磁盘事实的投影（骨架 vite.plugins.ts 的 virtual:story-list）。
    // 创作形态只决定产物从哪来，不该再长出一个需要同步的第二事实来源。
    expect(
      STORY_FILES.some(([path]) => path.endsWith("/src/stories.ts")),
      "story 层不应带自己的 src/stories.ts",
    ).toBe(false);
  });

  it("story 层不覆盖工程清单：entry 与 id 由生成器与使用者决定", () => {
    // 清单里的 id 是工程名占位符、entry 指向首列；层里覆盖一份就把生成器的
    // 占位符替换与 id 规则整个绕过去了（历史 bug：层里的 id 曾写死成列名）。
    expect(
      STORY_FILES.some(([path]) => path.endsWith("Resources/project.json")),
      "story 层不应覆盖 Resources/project.json",
    ).toBe(false);
  });
});

/**
 * 互斥声明是形态问答的唯一依据：生成器不再维护合法形态白名单，它只读这里的
 * `excludes` 反推「哪些组合不能同时选」。所以这份声明必须自身站得住——
 * 指向不存在的 id 会让互斥静默失效，单边声明会让「先声明的一方赢了」变成
 * 顺序的偶然产物，而页面结构两处都写就会在合并时互相覆盖。
 */
describe("模板叠加层：互斥声明", () => {
  /** 声明过的全部 id，含没有目录的缺省项：`excludes` 是按 id 解析的，不分维度 */
  const ALL_IDS = new Set(ALL_OPTIONS.map((option) => option.id));

  /** 某层声明排斥的层 id 表 */
  function excludesOf(optionId: string): string[] {
    const option = ALL_OPTIONS.find((item) => item.id === optionId);
    return option?.excludes ?? [];
  }

  /** 层目录里是否有页面结构的入口文件或视图文件 */
  function ownsPageStructure(optionId: string): boolean {
    return overlayFiles(optionId).some(([path]) => {
      const rest = path.slice(`../../template/v1/overlays/${optionId}/`.length);
      return (
        rest.startsWith("src/main.") ||
        rest.startsWith("src/App.") ||
        /^src\/[^/]*\/App\.(vue|tsx)$/.test(rest)
      );
    });
  }

  it("excludes 里的每个 id 都是真实声明过的层", () => {
    for (const option of ALL_OPTIONS) {
      for (const excluded of option.excludes ?? []) {
        expect(
          ALL_IDS.has(excluded),
          `${option.id} 排斥了未声明的层 ${excluded}`,
        ).toBe(true);
      }
    }
  });

  it("互斥是对称的：A 排斥 B，则 B 也排斥 A", () => {
    for (const option of ALL_OPTIONS) {
      for (const excluded of option.excludes ?? []) {
        expect(
          excludesOf(excluded),
          `${excluded} 没有反向排斥 ${option.id}`,
        ).toContain(option.id);
      }
    }
  });

  it("页面结构只能有一个所有者：两处都写入口文件的层必须互斥", () => {
    const owners = ALL_OPTIONS.map((option) => option.id).filter(
      ownsPageStructure,
    );
    expect(owners.length).toBeGreaterThan(1);
    for (const left of owners) {
      for (const right of owners) {
        if (left === right) continue;
        const declared =
          excludesOf(left).includes(right) || excludesOf(right).includes(left);
        expect(
          declared,
          `${left} 与 ${right} 都写页面结构，却没有在任一方声明互斥`,
        ).toBe(true);
      }
    }
  });

  it("已知的四对互斥逐条钉住", () => {
    expect(excludesOf("vue")).toEqual(
      expect.arrayContaining(["react", "miniprogram"]),
    );
    expect(excludesOf("react")).toEqual(
      expect.arrayContaining(["vue", "miniprogram"]),
    );
    expect(excludesOf("tauri")).toEqual(
      expect.arrayContaining(["miniprogram"]),
    );
    expect(excludesOf("miniprogram")).toEqual(
      expect.arrayContaining(["vue", "react", "tauri"]),
    );
  });

  it("故事文件层不排斥任何层：它可以叠在任一形态上", () => {
    expect(excludesOf("story")).toEqual([]);
  });

  it("缺省项不参与互斥：它们没有目录，也不出现在形态选项面", () => {
    for (const option of ALL_OPTIONS) {
      if (!NO_DIRECTORY_OPTIONS.has(option.id)) continue;
      expect(option.excludes ?? [], `${option.id} 不该声明 excludes`).toEqual(
        [],
      );
    }
  });
});

describe("模板叠加层：工程 tsconfig 不得把故事源收进组件检查面", () => {
  /**
   * 故事源是独立的 TS 工程（`tsconfig.stories.json`，纯 tsc）。它 `import X from
   * ".../ui/X/X.vue"` 拿到的是 `UiHandle`，靠 `@lingfan-engine/stories-build/authoring`
   * 的 ambient 通配折叠出来。
   *
   * 一旦故事源落进工程根 tsconfig 的检查面、而那份 tsconfig 又认得组件
   * （Vue 的 `*.vue`、React 的 `*.tsx`），编译器会优先把模块解析成真实组件类型，
   * 盖过 ambient 通配：`mount(hub)` 当场变成「DefineComponent 不能赋给 UiHandle」。
   * 这个错误只在 `typecheck` 出现，`vite dev` 照样能跑，使用者往往直到写 UI 挂载时才撞上。
   *
   * 判据：任何带 `include` 覆盖 `src/**` 的层 tsconfig，都必须 `exclude` 故事源目录。
   */
  function storiesExcluded(source: string): boolean {
    const match = source.match(/"exclude"\s*:\s*\[([^\]]*)\]/);
    if (match === null) return false;
    return match[1]!.includes("src/Stories.src/**");
  }

  const layerTsconfigs = Object.keys(OVERLAY_SOURCES)
    .filter((path) => path.endsWith("/tsconfig.json"))
    .sort();

  it("带 tsconfig 的层都被收到判据里（防判据空跑）", () => {
    expect(layerTsconfigs.length).toBeGreaterThan(0);
  });

  it("覆盖 src/** 的层 tsconfig 必须排除 src/Stories.src/**", () => {
    for (const path of layerTsconfigs) {
      const source = OVERLAY_SOURCES[path] ?? "";
      expect(source, `${path} 该有 include`).toContain('"include"');
      expect(
        storiesExcluded(source),
        `${path} 没有排除 src/Stories.src/**：故事源会被组件编译器接管，类型报错`,
      ).toBe(true);
    }
  });

  it("骨架的工程 tsconfig 不必排除：它只认 *.ts，故事源由它自己那份扛", () => {
    const skeletonTsconfig = (
      import.meta.glob("../../template/v1/__PROJECT__/tsconfig.json", {
        eager: true,
        query: "?raw",
        import: "default",
      }) as Record<string, string>
    )["../../template/v1/__PROJECT__/tsconfig.json"];
    expect(skeletonTsconfig).toBeDefined();
    expect(skeletonTsconfig).not.toContain("src/**/*.vue");
  });
});

describe("模板叠加层：故事源的界面句柄不默认导入组件文件", () => {
  /**
   * 组件编译器（vue-tsc、编辑器的 Vue / TSX 语言服务）会把 `.vue` / `.tsx`
   * 解析成真实组件类型，优先级高于 `authoring` 声明的 `UiHandle` 通配——
   * 于是 `mount(句柄)` 变成「组件不能赋给句柄」。纯 tsc 没有组件解析能力，
   * 看不出问题，所以这条只会在编辑器里红，仓库门禁却是绿的。
   *
   * 交付出去的工程由使用者自己开编辑器，不是使用者自己修类型。所以句柄必须
   * 从构建生成物取（`src/gen/ui_register.g`），那条路径不经过组件解析。
   *
   * 判据落在源码文本上：叠加层交付的故事源不得默认导入组件文件。
   */
  const storySources = Object.keys(OVERLAY_SOURCES)
    .filter((path) => path.includes("/src/Stories.src/"))
    .sort();

  it("带故事源的层都被收到判据里（防判据空跑）", () => {
    expect(storySources.length).toBeGreaterThan(0);
  });

  it("故事源不得默认导入组件文件：句柄从生成物取", () => {
    const offenders: string[] = [];
    for (const path of storySources) {
      const source = OVERLAY_SOURCES[path] ?? "";
      const hit = /import\s+\w+\s+from\s+["'][^"']*\.(?:vue|tsx|html)["']/.exec(
        source,
      );
      if (hit !== null) offenders.push(`${path}: ${hit[0]}`);
    }
    expect(
      offenders,
      `故事源默认导入组件文件：组件编译器会把它们解析成组件类型，mount(句柄) 在编辑器里报型不匹配。句柄请从 src/gen/ui_register.g 取：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("层里交付的注册表含具名句柄：句柄有处可取", () => {
    for (const path of storySources) {
      const layer = path.slice(
        "../../template/v1/overlays/".length,
        path.indexOf("/src/Stories.src/"),
      );
      const registry =
        OVERLAY_SOURCES[
          `../../template/v1/overlays/${layer}/src/gen/ui_register.g.ts`
        ];
      expect(
        registry,
        `${layer} 的故事源取句柄，但层里没有交付注册表`,
      ).toBeDefined();
      expect(registry).toMatch(/export const \w+: UiHandle<"/);
    }
  });
});

describe("模板叠加层：小程序图片的填充方式", () => {
  /**
   * 小程序没有 `object-fit`：`<image>` 只有五个 `mode`，语义与 CSS 不完全对应。
   * 元素层的填充词表在描述树里已折成 `object-fit`，所以小程序侧只能按那五个词反查。
   *
   * 缺口两条，都是平台事实而非取舍：`scale-down`（只缩不放）无法表达，退化为
   * `aspectFit`——小图会被放大；`widthFix`（宽度固定、高度自适应）根本不是填充语义，
   * 拿它当缺省会让没写填充的图按原始比例撑开，与元素层缺省 `cover` 的观感相反。
   */
  const FITS = [
    ["fill", "scaleToFill"],
    ["contain", "aspectFit"],
    ["cover", "aspectFill"],
    ["none", "center"],
    ["scale-down", "aspectFit"],
  ] as const;

  it("五个填充词各自映射到平台的 mode", () => {
    for (const [fit, mode] of FITS) {
      expect(imageModeOf(fit), `${fit} 的 mode 不对`).toBe(mode);
    }
  });

  it("未声明与写坏都落到缺省 mode（与元素层缺省 cover 同向）", () => {
    expect(imageModeOf(undefined)).toBe("aspectFill");
    expect(imageModeOf("")).toBe("aspectFill");
    expect(imageModeOf("stretch")).toBe("aspectFill");
  });

  it("图像节点从描述样式的 object-fit 反查 mode", () => {
    const node = toMiniNode(
      {
        kind: "image",
        style: { objectFit: "contain" },
        props: { src: "/a.png" },
      },
      "0",
    );
    expect(node.mode).toBe("aspectFit");
    expect(node.src).toBe("/a.png");
  });

  it("图像节点没写填充时仍有 mode，不留空", () => {
    expect(toMiniNode({ kind: "image" }, "0").mode).toBe("aspectFill");
  });

  it("非图像节点不带 mode：平台只有 <image> 认这个属性", () => {
    expect(toMiniNode({ kind: "box" }, "0").mode).toBeUndefined();
    expect(
      toMiniNode({ kind: "media", style: { objectFit: "fill" } }, "0").mode,
    ).toBeUndefined();
  });

  it("模板把 mode 绑到数据，不回退成硬编码", () => {
    const path = Object.keys(OVERLAY_SOURCES).find((key) =>
      key.endsWith("/miniprogram/src/components/NodeTree.vue"),
    );
    expect(path, "找不到小程序的节点模板").toBeDefined();
    const source = OVERLAY_SOURCES[path!] ?? "";
    expect(source).toMatch(/:mode="node\.mode/);
    expect(source).not.toMatch(/mode="widthFix"/);
  });
});
