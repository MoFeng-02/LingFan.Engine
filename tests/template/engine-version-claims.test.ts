/**
 * 模板两处版本声明与叠加层 API 面的互锁（源级扫描，不跑构建、不装依赖）。
 *
 * 这条判据补的是**门禁的盲区**，不是重复劳动：`__PROJECT__/src` 已在根 `tsconfig.json`
 * 的 `include` 里，模板调用了引擎没有的成员会被 `pnpm typecheck` 直接报 `TS2339`；
 * 但 `template/v1/overlays/**` 被同一份配置的 `exclude` 排除（它们各自带 tsconfig、
 * 依赖本仓没装的框架），**没有任何门禁会 typecheck 它们**。叠加层里写错一个偏好字段，
 * 生成出来的工程要到用户 `pnpm dev` 才炸。
 *
 * 另外两件事必须互相对齐，否则声明本身自相矛盾：
 * 1. `minEngineVersion` 与引擎依赖区间的下界必须一致。两处各自独立书写，任一处漏改
 *    都会得到「模板一边说至少要 X、一边按 Y 装包」的清单；而 `checkEngineCompatibility`
 *    只在 registry 可达时比对、离线直接放行，离线用户不会得到任何提示。
 * 2. 八份清单里的引擎包版本由 `pnpm release` 统一升，模板是第九份、不在该脚本的
 *    写入范围内，因此「发完版模板仍钉旧版」是默认结果而不是意外。
 *
 * **这条判据抓不到什么，必须说清楚**：它只比对源码面，抓不到「引擎源码已有、registry
 * 尚未发布」。那种情形下本文件全部通过，而真实工程装上已发布版本仍会崩在运行期。
 * 真治要靠 CI：打标签发布后生成工程、装**已发布**版本再 typecheck。
 *
 * 用 `?raw` / `import.meta.glob` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import { PlayerPreferences } from "@lingfan-engine/core";
import templateMetaJson from "../../template/v1/template-meta.json?raw";
import templatePkgJson from "../../template/v1/__PROJECT__/package.json?raw";
import rootPkgJson from "../../package.json?raw";
import { floorOfRange } from "../../packages/create/src/shared/semver.ts";

/** `template-meta.json` 里与本判据相关的字段 */
interface TemplateMeta {
  version: string;
  minEngineVersion: string;
}

/** 清单里与版本判定相关的字段 */
interface PackageManifest {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** 引擎包作用域：与 `packages/create/src/registry/compat.ts` 的 `ENGINE_SCOPE` 同值 */
const ENGINE_SCOPE = "@lingfan-engine/";

/** 叠加层全部源码文本，键 = 仓库相对路径 */
const OVERLAY_SOURCES = import.meta.glob(
  "../../template/v1/overlays/**/*.{ts,tsx,vue}",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 偏好运行时源码（取私有成员名单用；`export *` 不导出私有成员） */
const PREFERENCES_LOADERS = import.meta.glob(
  "../../packages/core/src/runtime/preferences/state.ts",
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

/** 把 glob 键归一成仓库相对路径 */
function repoPath(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

/** 抹掉注释，只留代码：注释里写 `preferences.xxx` 不该被当成真实调用 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * 公开成员面：取原型上的全部成员，再减去源码里声明为 `private` 的那些。
 *
 * 为什么要减：`private` 成员在运行期同样挂在原型上，反射看得见，但模板侧写一句
 * `preferences.update(...)` 会直接编译不过。不减就会把「不该允许」当成「允许」，
 * 判据从此只会漏报、不会误报——漏报比误报更能麻痹人。
 */
async function publicMembers(): Promise<Set<string>> {
  const reflected = new Set(
    Object.getOwnPropertyNames(PlayerPreferences.prototype),
  );

  const loader = Object.entries(PREFERENCES_LOADERS)[0]?.[1];
  if (loader === undefined) {
    throw new Error(
      "找不到偏好运行时源码 packages/core/src/runtime/preferences/state.ts——私有成员无从判定，本判据拒绝在盲态下放行",
    );
  }
  const source = await loader();
  for (const matched of source.matchAll(
    /^\s+private\s+(?:readonly\s+)?([\w$]+)/gm,
  )) {
    reflected.delete(matched[1]!);
  }
  return reflected;
}

/** 叠加层里所有 `preferences.<成员>` 的调用点，按文件归组 */
function preferencesUsages(): Map<string, Set<string>> {
  const usages = new Map<string, Set<string>>();
  for (const [key, text] of Object.entries(OVERLAY_SOURCES)) {
    const code = stripComments(text);
    const found = new Set<string>();
    for (const matched of code.matchAll(/\bpreferences\.([\w$]+)/g)) {
      found.add(matched[1]!);
    }
    // `preferences.json` 是 tauri 侧的偏好文件名，命中时会落在成员位；它没有上下文
    // 可判，靠 `publicMembers()` 那边天然不存在而报错——故此处只收标识符形状的候选，
    // 由下面的断言统一给出人话解释。
    if (found.size > 0) usages.set(repoPath(key), found);
  }
  return usages;
}

describe("叠加层的引擎 API 面（门禁盲区：overlays 不被 typecheck）", () => {
  it("叠加层用到的每个 preferences 成员都在偏好层的公开面上", async () => {
    const available = await publicMembers();
    expect(available.size).toBeGreaterThan(50);

    const problems: string[] = [];
    for (const [path, members] of preferencesUsages()) {
      for (const member of members) {
        if (available.has(member)) continue;
        problems.push(`${path}: preferences.${member}`);
      }
    }
    expect(
      problems.sort(),
      `叠加层用了偏好层没有的成员（这些文件不在任何 typecheck 覆盖面里）：\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("叠加层确实被扫到了（防空转：glob 失效时本判据会假装通过）", () => {
    const paths = Object.keys(OVERLAY_SOURCES).map(repoPath);
    // 不写死文件数（加一个叠加层就红）；这里只防「glob 没匹配上」这种假绿
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.some((path) => path.includes("miniprogram"))).toBe(true);
    expect(paths.some((path) => path.includes("overlays/vue"))).toBe(true);
    // tauri 层只有 Rust 与清单补丁，没有 TS 源——它的 API 面天然不在此判据内
    expect(paths.some((path) => path.includes("overlays/tauri"))).toBe(false);
    // 偏好调用点必须真的存在，否则上一条断言在扫描面为空时也会通过
    expect(preferencesUsages().size).toBeGreaterThan(0);
  });

  it("把私有成员排除在外（判据自己也要被验：否则它只会漏报）", async () => {
    const available = await publicMembers();
    // 三者都是 state.ts 里 `private` 声明的实现细节，模板不得调用
    expect(available.has("update")).toBe(false);
    expect(available.has("emit")).toBe(false);
    expect(available.has("scheduleSave")).toBe(false);
    // 反面：公开成员必须留着，别把判据改成「什么都不允许」
    expect(available.has("setFontFamily")).toBe(true);
    expect(available.has("snapshot")).toBe(true);
    expect(available.has("onChange")).toBe(true);
  });
});

describe("模板的两处版本声明必须互相自洽", () => {
  const meta = JSON.parse(templateMetaJson) as TemplateMeta;
  const pkg = JSON.parse(templatePkgJson) as PackageManifest;

  it("minEngineVersion 与每个引擎依赖区间的下界一致", () => {
    const engineRanges: Array<[string, string]> = [];
    for (const table of [pkg.dependencies, pkg.devDependencies]) {
      for (const [name, range] of Object.entries(table ?? {})) {
        if (name.startsWith(ENGINE_SCOPE)) engineRanges.push([name, range]);
      }
    }
    expect(engineRanges.length).toBeGreaterThanOrEqual(6);

    const problems: string[] = [];
    for (const [name, range] of engineRanges) {
      const floor = floorOfRange(range);
      if (floor === undefined) {
        problems.push(`${name} 的区间 "${range}" 解析不出下界`);
        continue;
      }
      if (floor !== meta.minEngineVersion) {
        problems.push(
          `${name} 的区间 "${range}" 下界是 ${floor}，但 minEngineVersion 是 ${meta.minEngineVersion}`,
        );
      }
    }
    expect(
      problems.sort(),
      `模板的两处版本声明互相矛盾（生成器按依赖区间装包、按 minEngineVersion 拒绝启动，两者不一致时必有一侧说谎）：\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("两处版本号都是严格的 X.Y.Z（防范围符号与 v 前缀混入）", () => {
    // 只锁形状：`parseSemver` 拒 `v0.7.2` 与 `^0.7.2`，但这两个字段不经过它，
    // 写错了要等到生成器拿去比较时才炸，且报错点在消费者而不在这份清单上。
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(meta.minEngineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("模板不该落后于本仓当前的引擎版本（发行时最容易漏的就是这里）", () => {
    const root = JSON.parse(rootPkgJson) as PackageManifest;
    expect(root.version).toBeDefined();
    // 模板依赖的下界必须等于仓根版本：发版时 `pnpm release` 只改八份清单，
    // 模板是第九份、不会被它带着升，于是「发完版模板仍钉旧版」是常态而非意外。
    for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
      if (!name.startsWith(ENGINE_SCOPE)) continue;
      expect(
        floorOfRange(range),
        `${name} 的区间 "${range}" 落后于仓根 ${root.version}——发版后要手工对齐模板依赖与 minEngineVersion`,
      ).toBe(root.version);
    }
  });
});
