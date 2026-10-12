/**
 * 创作链编译包的边界与结构不变式：包化之后，「谁还能引用旧路径」「包的出口面是哪几个」
 * 「CLI 怎么找到宿主工程」这三条约定没有测试守着，下一次改动可能无声地破坏它们
 * （最典型的是有人图省事又写回 `apps/playground/scripts/stories-build` 之类的相对路径，
 * 表面能跑，包化即失效）。
 *
 * 手法沿用 tests/editor/editor-package-structure.test.ts：用打包器的 ?raw 把源码当
 * 文本断言（测试跑在浏览器无关环境也不碰文件系统），来源是 import.meta.glob 的
 * 结构化键（目录索引天然展开成 ../cell/index.ts，无需处理裸目录说明符）。
 *
 * 「清单 / 出口面 / 托管键」这类断言必须**先读实物再写断言**：本文件第一版只在合成
 * 字面量上测出口面正则，实物 `exports` 里根本没有 `./cli`，也照样 5/5 通过——样本可以
 * 拿来自检，但不能当唯一的断言对象。`package.json` 不是 .ts、不在源码扫描面里，故单列
 * 一张 manifest 面。
 *
 * 每条断言都先自检扫描面非空、并拿合成字面量验证正则不恒真不恒假——「glob 写错 ⇒
 * 空扫描 ⇒ 绿」是本仓已吃过一次的假绿形态。
 */
import { describe, expect, it } from "vitest";

/** 包内全部源码，键 = 相对本测试文件的 glob 模式（打包器读取） */
const PACKAGE_SOURCE_FILES = import.meta.glob("../../packages/stories-build/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 全仓测试与宿主侧残留引用扫描面（源码域）；测试域单独一张 */
const WORKSPACE_SOURCE_FILES = import.meta.glob(
  ["../../apps/*/src/**/*.{ts,vue}", "../../packages/*/src/**/*.ts"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const WORKSPACE_TEST_FILES = import.meta.glob("../../tests/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const PACKAGE_KEYS = Object.keys(PACKAGE_SOURCE_FILES);
const SOURCE_KEYS = Object.keys(WORKSPACE_SOURCE_FILES);
const TEST_KEYS = Object.keys(WORKSPACE_TEST_FILES);

/**
 * 包的实物清单。出口面是**实物属性**而非源码写法，所以这里按文本读真 package.json
 * 再解析——不用 `import pkg from "...json"`：根 tsconfig 未开 resolveJsonModule
 * （统一 moduleResolution: "bundler"），JSON 导入会额外要断言/插件，不值当。
 */
const PACKAGE_MANIFEST_FILES = import.meta.glob("../../packages/stories-build/package.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const MANIFEST_KEYS = Object.keys(PACKAGE_MANIFEST_FILES);

interface PackageManifest {
  exports?: Record<string, string>;
}

const PACKAGE_MANIFEST = JSON.parse(
  MANIFEST_KEYS.length === 1 ? PACKAGE_MANIFEST_FILES[MANIFEST_KEYS[0]] : "{}",
) as PackageManifest;

/**
 * 包外不得再出现的旧路径说明符。两段式匹配，避免误伤：
 * - 前缀段 `…/apps/playground/scripts/` 只对**创作链编译**那几个落点（stories-build /
 *   cell / cell-extract / build）算旧路径——`scripts/prepare-dist.mjs` 没搬家，仍在原处；
 * - 裸段匹配包内旧相对形态（`./build/…`、`cell-extract`），只可能在包内残留。
 */
const STALE_SPECIFIER_PATTERN =
  /(?:from|import)\s*\(?\s*"(?:\.{1,2}\/)*apps\/playground\/scripts\/(?:stories-build|cell-extract|cell\/|build\/|build")|(?:from|import)\s*\(?\s*"\.{1,2}\/(?:build\/[^"]+|cell-extract)"/;

/**
 * 包内不得出现「猜宿主工程在哪」的写法：包不知道谁在调它
 */
const HOST_GUESS_PATTERN = /new URL\(\s*"\.\.(?:\/\.\.)*"\s*,\s*import\.meta\.url\s*\)/;

/** 出口面必须是这几条，多一条少一条都算契约变更（改这里要同时改 package.json） */
const EXPECTED_EXPORTS = [".", "./cell", "./cli"];

describe("创作链编译包 · 边界与结构不变式", () => {
  it("扫描面自检：三张 glob 都非空且命中已知文件（防空扫描假绿）", () => {
    expect(PACKAGE_KEYS.length).toBeGreaterThanOrEqual(40);
    expect(PACKAGE_KEYS.some((key) => key.endsWith("/src/index.ts"))).toBe(true);
    expect(PACKAGE_KEYS.some((key) => key.endsWith("/src/cell/index.ts"))).toBe(true);
    expect(PACKAGE_KEYS.some((key) => key.endsWith("/src/cli/cli.ts"))).toBe(true);
    expect(SOURCE_KEYS.length).toBeGreaterThanOrEqual(50);
    expect(TEST_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it("旧路径零残留：宿主源码与全仓测试都不再引用 scripts/build、cell-extract", () => {
    // 正样本自检：正则必须命中历史写法，且放过新写法。
    expect(STALE_SPECIFIER_PATTERN.test('from "../../apps/playground/scripts/stories-build";')).toBe(true);
    expect(STALE_SPECIFIER_PATTERN.test('from "../../apps/playground/scripts/build/compiler-contract";')).toBe(true);
    expect(STALE_SPECIFIER_PATTERN.test('from "../../apps/playground/scripts/cell-extract";')).toBe(true);
    expect(STALE_SPECIFIER_PATTERN.test('from "@lingfan/stories-build";')).toBe(false);
    expect(STALE_SPECIFIER_PATTERN.test('from "@lingfan/stories-build/cell";')).toBe(false);

    // 管道级自检：把历史写法拼进扫描面必须能被抓到（证明扫的是真文本）。
    const allText = [...SOURCE_KEYS, ...TEST_KEYS]
      .map((key) => WORKSPACE_SOURCE_FILES[key] ?? WORKSPACE_TEST_FILES[key])
      .join("\n");
    expect(STALE_SPECIFIER_PATTERN.test(`${allText}\nfrom "../../apps/playground/scripts/cell-extract";`)).toBe(true);

    const offenders = [...SOURCE_KEYS, ...TEST_KEYS].filter((key) =>
      STALE_SPECIFIER_PATTERN.test(WORKSPACE_SOURCE_FILES[key] ?? WORKSPACE_TEST_FILES[key] ?? ""),
    );
    expect(offenders).toEqual([]);
  });

  it("包不猜宿主工程：没有「import.meta.url 的上一级即工程根」这种写法", () => {
    expect(HOST_GUESS_PATTERN.test('fileURLToPath(new URL("..", import.meta.url));')).toBe(true);
    expect(HOST_GUESS_PATTERN.test('fileURLToPath(new URL("../../..", import.meta.url));')).toBe(true);
    expect(HOST_GUESS_PATTERN.test('fileURLToPath(new URL("../../packages/x", import.meta.url));')).toBe(false);

    const offenders = PACKAGE_KEYS.filter((key) => HOST_GUESS_PATTERN.test(PACKAGE_SOURCE_FILES[key]));
    expect(offenders).toEqual([]);
  });

  it("包清单先被真读到：glob 恰命中一个 manifest 且能解析出 exports（防空扫描假绿）", () => {
    expect(MANIFEST_KEYS).toEqual(["../../packages/stories-build/package.json"]);
    expect(Object.keys(PACKAGE_MANIFEST.exports ?? {}).length).toBeGreaterThan(0);
  });

  it("包的出口面由实物 package.json 决定：恰为 ., ./cell, ./cli 三条且落点正确", () => {
    // 实物断言：键集与值都来自真 manifest，不是合成字面量。
    expect(Object.keys(PACKAGE_MANIFEST.exports ?? {}).sort()).toEqual(EXPECTED_EXPORTS);
    expect(PACKAGE_MANIFEST.exports?.["."]).toBe("./src/index.ts");
    expect(PACKAGE_MANIFEST.exports?.["./cell"]).toBe("./src/cell/index.ts");
    // CLI 必须是包的一等入口：模板工程只有 `pnpm add @lingfan/stories-build` 这一条路，
    // 拿不到 ./cli 就只能写 monorepo 内部裸路径，包化对模板即失效。
    expect(PACKAGE_MANIFEST.exports?.["./cli"]).toBe("./src/cli/cli.ts");

    // 每条出口的落点都得在包内真实存在（键对值错同样是坏）。glob 键形如
    // `../../packages/stories-build/src/cli/cli.ts`，故把 exports 的 `./src/…` 换算成
    // `/src/…` 做后缀比对——只去掉开头的点，别再加前缀，否则会得到 `/src/src/…`。
    const exportTargets = Object.values(PACKAGE_MANIFEST.exports ?? {});
    expect(exportTargets.length).toBe(EXPECTED_EXPORTS.length);
    for (const target of exportTargets) {
      expect(target.startsWith("./src/")).toBe(true);
      const relative = target.replace(/^\./, "");
      expect(PACKAGE_KEYS.some((key) => key.endsWith(relative))).toBe(true);
    }

    // CLI 自己必须走包的唯一出口，不得绕过出口面直接取实现叶子。
    const cliSource = PACKAGE_SOURCE_FILES[PACKAGE_KEYS.find((key) => key.endsWith("/src/cli/cli.ts")) ?? ""];
    expect(typeof cliSource).toBe("string");
    expect(cliSource).toMatch(/from "\.\.\/index"/);
    expect(cliSource).not.toMatch(/from "\.\.\/pipeline"/);
  });

  it("目录索引导入是包内一等形态（不写 ../cell/index.ts），相对导入保持无扩展名", () => {
    // 无扩展名的相对导入是本仓 house style（tsx 与 vite 都按 TS 解析）；带 .ts 一律算失配。
    expect(/from "\.{1,2}\/[^"]+\.ts"/.test('from "./cell/index.ts";')).toBe(true);
    expect(/from "\.{1,2}\/[^"]+\.ts"/.test('from "../cell";')).toBe(false);

    const extensioned = PACKAGE_KEYS.filter((key) =>
      /from "\.{1,2}\/[^"]+\.ts"/.test(PACKAGE_SOURCE_FILES[key]),
    );
    expect(extensioned).toEqual([]);
    // 反向自检：包内确实存在相对导入（否则上面的空集是空扫描换来的）。
    const relativeImporters = PACKAGE_KEYS.filter((key) =>
      /from "\.{1,2}\/[^"]+"/.test(PACKAGE_SOURCE_FILES[key]),
    );
    expect(relativeImporters.length).toBeGreaterThanOrEqual(20);
  });
});
