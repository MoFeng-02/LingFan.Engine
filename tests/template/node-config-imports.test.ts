/**
 * 构建配置的引擎导入必须是「Node 能直接加载」的落点（源级扫描，不跑构建、不装依赖）。
 *
 * 判据的由来：包以 TypeScript 源码出口（`exports` 指向 `./src/*.ts`），而 **Node 的类型擦除
 * 拒绝加载 node_modules 里的 .ts**（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）。vitest
 * 与 tsc 都能吃 .ts，所以在仓库里跑得好好的；但 `vite.config.ts` 是 **Node 直接加载**的文件，
 * vite 默认的配置加载器还会把依赖外置成真实 ESM import——工程一生成、`pnpm dev` 就崩在
 * 配置加载这一步，而门禁全绿。这类失配必须在本仓就拦住。
 *
 * 规则：模板里由 Node 直接执行的配置文件（`vite.config.ts`、`vite.plugins.ts`）对
 * `@lingfan-engine/*` 的**值导入**，其子路径在包 `exports` 里解析出的运行时落点不得是 `.ts`；
 * 缺省导出（字符串形态）与条件导出的 `default` 条件都算运行时落点，`types` 条件不算
 * （它只给 TypeScript，不参与 Node 解析）。
 *
 * `import type { … }` 不参与判定：类型导入在编译期擦除，运行时不加载。
 */
import { describe, expect, it } from "vitest";

/**
 * 包内文件的按需读取器（不做 eager：源码量级大，且本判据只碰少数几个落点）。
 *
 * 除 `src/**` 的源码与清单，还要收包根的 `.mjs` 垫片——运行时落点允许是「随包的非 .ts 文件」，
 * 那类文件就放在包根（`host-plugins.mjs` 这一层）。
 */
const PACKAGE_LOADERS = import.meta.glob(
  [
    "../../packages/*/src/**/*.ts",
    "../../packages/*/package.json",
    "../../packages/*/*.mjs",
  ],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

/** 模板全部源码文本（体量小，直接 eager 读入） */
const TEMPLATE_TEXT = import.meta.glob("../../template/v1/**/*.{ts,tsx,vue}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** glob 键归一成仓库相对路径 */
function repoPath(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

/** 仓库相对路径 → 按需读取器 */
const LOADERS = new Map<string, () => Promise<string>>();
for (const [key, load] of Object.entries(PACKAGE_LOADERS)) {
  LOADERS.set(repoPath(key), load);
}

/** 读一个仓库相对路径的源码，不存在返回 null */
async function readSource(path: string): Promise<string | null> {
  const load = LOADERS.get(path);
  return load === undefined ? null : load();
}

/** 抹掉注释，只留代码 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * 由 Node 直接执行的模板文件。
 *
 * `vite.config.ts` 是 vite 的配置入口；`vite.plugins.ts` 被它 import，在 bundle 加载器下
 * 依赖外置，因此它引的包同样是 Node 加载。新增同类配置文件时加进这张表。
 */
const NODE_LOADED = new Set(["vite.config.ts", "vite.plugins.ts"]);

/** 值导入（排除 `import type`）：`import { a } from "@lingfan-engine/x/y"` */
const RE_VALUE_IMPORT =
  /import\s+(?!type\b)(?:[A-Za-z_$][\w$]*\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*)\s*from\s*"(@lingfan-engine\/[a-z-]+)(\/[a-z-]+)?"/g;

interface NodeConfigImport {
  /** 模板内的仓库相对路径 */
  file: string;
  /** 包名（去 scope） */
  pkg: string;
  /** 子路径（根导入为 null） */
  subpath: string | null;
}

/** 收集模板里由 Node 加载的文件对引擎包的值导入 */
function collectNodeConfigImports(): NodeConfigImport[] {
  const out: NodeConfigImport[] = [];
  for (const key of Object.keys(TEMPLATE_TEXT).sort()) {
    const path = repoPath(key);
    const base = path.slice(path.lastIndexOf("/") + 1);
    if (!NODE_LOADED.has(base)) continue;
    const source = stripComments(TEMPLATE_TEXT[key]);
    for (const match of source.matchAll(RE_VALUE_IMPORT)) {
      out.push({
        file: path,
        pkg: (match[1] ?? "").replace("@lingfan-engine/", ""),
        subpath: match[2] ?? null,
      });
    }
  }
  return out;
}

/** 条件导出：`types` 给 TypeScript，`default` 给 Node 运行时 */
interface ConditionalExport {
  types?: string;
  default?: string;
}

type ExportTarget = string | ConditionalExport;

/** 某包的 `exports` 映射 */
async function packageExports(
  pkg: string,
): Promise<Record<string, ExportTarget> | null> {
  const raw = await readSource(`packages/${pkg}/package.json`);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { exports?: Record<string, ExportTarget> };
  return parsed.exports ?? {};
}

/** 运行时落点：字符串形态即本身，条件导出取 `default`（`types` 不参与 Node 解析） */
function runtimeTarget(target: ExportTarget | undefined): string | null {
  if (target === undefined) return null;
  return typeof target === "string" ? target : (target.default ?? null);
}

/** 是否 TypeScript 源码落点（Node 的类型擦除拒绝加载 node_modules 下的这类文件） */
function isTypeScriptTarget(target: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(target);
}

describe("构建配置的引擎导入 · Node 可直接加载", () => {
  it("扫描面自检：确实收到了由 Node 加载的配置文件与其引擎导入（glob 失配立刻失败）", () => {
    expect(Object.keys(TEMPLATE_TEXT).length).toBeGreaterThanOrEqual(60);
    // 正样本自检：正则必须命中真实写法，且放过 `import type`
    const sample = 'import { a } from "@lingfan-engine/core/x";';
    expect([...sample.matchAll(RE_VALUE_IMPORT)].length).toBe(1);
    expect(
      [
        ...'import type { A } from "@lingfan-engine/core/x";'.matchAll(
          RE_VALUE_IMPORT,
        ),
      ].length,
    ).toBe(0);

    const imports = collectNodeConfigImports();
    // 骨架的 `vite.plugins.ts` 是唯一直接引引擎包的 Node 加载文件；各层 `vite.config.ts`
    // 引的是相对路径 `./vite.plugins.ts`，引擎导入顺着它进来。数量为 0 说明扫描面失配。
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.some((item) => item.pkg === "stories-build")).toBe(true);
    // 各形态的 vite 配置都在扫描面内（缺一个就等于该形态没人守）
    const configs = Object.keys(TEMPLATE_TEXT)
      .map(repoPath)
      .filter((path) => /\/vite\.(?:config|plugins)\.ts$/.test(path));
    expect(configs.length).toBeGreaterThanOrEqual(5);
  });

  it("每个引擎子路径的运行时落点都不是 TypeScript 源码", async () => {
    const problems: string[] = [];
    for (const item of collectNodeConfigImports()) {
      const exportsMap = await packageExports(item.pkg);
      if (exportsMap === null) {
        problems.push(`${item.file}: 包 @lingfan-engine/${item.pkg} 无清单`);
        continue;
      }
      const key = item.subpath === null ? "." : `.${item.subpath}`;
      const target = runtimeTarget(exportsMap[key]);
      if (target === null) {
        problems.push(
          `${item.file}: @lingfan-engine/${item.pkg} 的 exports 里没有可用的运行时落点 "${key}"`,
        );
        continue;
      }
      if (isTypeScriptTarget(target)) {
        problems.push(
          `${item.file}: @lingfan-engine/${item.pkg}${item.subpath ?? ""} 的运行时落点是 ${target}——` +
            `Node 的类型擦除拒绝加载 node_modules 里的 .ts，装出来的工程会崩在配置加载这一步。` +
            `该子路径需要一个非 .ts 的 default 落点（如随包 .mjs 装载垫片），types 条件仍可指回源码。`,
        );
        continue;
      }
      // 落点必须真实随包存在：改错文件名同样是坏（tarball 里没有它）
      const exists =
        (await readSource(`packages/${item.pkg}/${target.slice(2)}`)) !== null;
      if (!exists) {
        problems.push(
          `${item.file}: @lingfan-engine/${item.pkg} 的运行时落点 ${target} 在包里不存在`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
