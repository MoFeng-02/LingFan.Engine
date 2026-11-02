/**
 * 模板 ↔ 引擎导出面互锁（源级扫描，不跑构建、不装依赖）。
 *
 * 模板是「按引擎当前源码写」的素材，不是按某个已发布版本写的。引擎加一个导出、
 * 删一个导出，模板里的具名导入都可能悄悄失配：模板侧看不出来，生成出来的工程
 * 一跑 `typecheck` 就是一片 `TS2305 Module has no exported member`。
 *
 * 这条判据把「失配」提前到本仓门禁里：解析各包公共出口（`packages/<pkg>/src/index.ts`）
 * 实际转发的名字集合，与 `template/v1/**` 里 `import { … } from "@lingfan-engine/<pkg>"`
 * 的每个具名导入逐一比对，缺一即红。深度子路径导入（`@lingfan-engine/x/y`）另按该包
 * `exports` 映射核，避免「换个子路径就装不上」。
 *
 * 源码按需异步取（非 eager glob）：出口的 `export *` 会沿目录树扩散到几百个文件，
 * 一次性全量读进来只为判据看一眼并不划算。
 *
 * 用 `?raw` / `import.meta.glob` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";

/** 包源码与清单的按需读取器，键 = glob 原文 */
const PACKAGE_LOADERS = import.meta.glob(
  ["../../packages/*/src/**/*.ts", "../../packages/*/package.json"],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

/** 模板全部源码文本（体量小，直接 eager 读入） */
const TEMPLATE_TEXT = import.meta.glob("../../template/v1/**/*.{ts,tsx,vue}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 把 glob 键归一成仓库相对路径（`../../packages/core/src/index.ts` → `packages/core/src/index.ts`） */
function repoPath(globKey: string): string {
  return globKey.replace(/^(\.\.\/)+/, "");
}

/** 仓库相对路径 → 按需读取器 */
const LOADERS = new Map<string, () => Promise<string>>();
for (const [key, load] of Object.entries(PACKAGE_LOADERS)) {
  LOADERS.set(repoPath(key), load);
}

/** 已读入的源码缓存（同一文件在一次判据里可能被多条转发链访问） */
const SOURCE_CACHE = new Map<string, string>();

/** 读一个仓库相对路径的源码，不存在返回 null */
async function readSource(path: string): Promise<string | null> {
  const cached = SOURCE_CACHE.get(path);
  if (cached !== undefined) return cached;
  const load = LOADERS.get(path);
  if (load === undefined) return null;
  const text = await load();
  SOURCE_CACHE.set(path, text);
  return text;
}

/** 抹掉注释，只留代码（注释里的 `export * from "…"` 不该被当成真转发） */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** 纯字符串层面的父目录（不引 node:path） */
function dirName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** 纯字符串层面的相对路径拼接 + 归一（`.` / `..` / 空段一律消掉） */
function joinPath(base: string, relative: string): string {
  const segments = `${base}/${relative}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * 解析一个模块说明符到仓库相对路径。
 *
 * 两种写法都有：带扩展名（`"./contracts/index.ts"`、`"./entities.ts"`）与不带
 * （`"./dialogue"`、`"./save"`），故按「原样 → `.ts` → `/index.ts`」依次试。
 */
async function resolveSpecifier(
  fromFile: string,
  specifier: string,
): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;
  const base = joinPath(dirName(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if ((await readSource(candidate)) !== null) return candidate;
  }
  return null;
}

/** 花括号里的导出名：去 `type` 前缀、取 `as` 之后的别名 */
function exportNames(block: string): string[] {
  return block
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.replace(/^type\s+/, ""))
    .map((part) => part.split(/\s+as\s+/).pop() ?? "")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 具名转发块：`export { a, b } from "…"` */
const RE_EXPORT_FROM = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
/** 仅转发星号：`export * from "…"` */
const RE_EXPORT_STAR = /export\s+\*\s+from\s*"([^"]+)"/g;
/** 命名空间转发：`export * as ns from "…"` */
const RE_EXPORT_STAR_NS = /export\s+\*\s+as\s+(\w+)\s+from\s*"([^"]+)"/g;
/** 原地具名导出（无 from）：`export { a, b };` */
const RE_EXPORT_LOCAL = /export\s+(?:type\s+)?\{([^}]*)\}\s*;/g;
/** 直接导出声明：`export declare const X` / `export type X =` / `export interface X` */
const RE_EXPORT_DECL =
  /export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

/**
 * 一个包公共出口实际暴露的名字全集。
 *
 * `export *` 递归展开（引擎的出口是「包出口 → 域出口 → 实现文件」多层结构），
 * 已经访问过的文件不再进入，天然挡住环形转发。
 */
async function exportedSurface(entry: string): Promise<Set<string>> {
  const names = new Set<string>();
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const raw = await readSource(file);
    if (raw === null) return;
    const source = stripComments(raw);
    for (const match of source.matchAll(RE_EXPORT_STAR_NS)) {
      names.add(match[1] ?? "");
    }
    for (const match of source.matchAll(RE_EXPORT_FROM)) {
      for (const name of exportNames(match[1] ?? "")) names.add(name);
    }
    for (const match of source.matchAll(RE_EXPORT_LOCAL)) {
      for (const name of exportNames(match[1] ?? "")) names.add(name);
    }
    for (const match of source.matchAll(RE_EXPORT_DECL)) {
      names.add(match[1] ?? "");
    }
    for (const match of source.matchAll(RE_EXPORT_STAR)) {
      const target = await resolveSpecifier(file, match[1] ?? "");
      if (target !== null) await visit(target);
    }
  };
  await visit(entry);
  names.delete("");
  return names;
}

/** 模板里的一处引擎导入 */
interface EngineImport {
  /** 来源文件（仓库相对路径） */
  file: string;
  /** 包名（去 scope，如 `core`） */
  pkg: string;
  /** 子路径（根导入为 null，如 `/authoring`） */
  subpath: string | null;
  /** 具名导入的名字（默认导入为 `default`） */
  names: string[];
}

/**
 * 具名导入：`import { a, b } from "@lingfan-engine/x"`。
 *
 * 方括号内禁止出现 `}`，因此不会跨语句吞行把别的包的导入算进来。
 */
const RE_NAMED_IMPORT =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(@lingfan-engine\/[a-z-]+)(\/[a-z-]+)?"/g;
/** 默认导入：`import foo from "@lingfan-engine/x"` */
const RE_DEFAULT_IMPORT =
  /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s*"(@lingfan-engine\/[a-z-]+)(\/[a-z-]+)?"/g;

/** 模板全量引擎导入 */
function collectImports(): EngineImport[] {
  const out: EngineImport[] = [];
  const paths = Object.keys(TEMPLATE_TEXT).map(repoPath).sort();
  for (const path of paths) {
    const raw = TEMPLATE_TEXT[`../../${path}`] ?? "";
    const source = stripComments(raw);
    for (const match of source.matchAll(RE_NAMED_IMPORT)) {
      out.push({
        file: path,
        pkg: (match[2] ?? "").replace("@lingfan-engine/", ""),
        subpath: match[3] ?? null,
        names: exportNames(match[1] ?? ""),
      });
    }
    for (const match of source.matchAll(RE_DEFAULT_IMPORT)) {
      out.push({
        file: path,
        pkg: (match[2] ?? "").replace("@lingfan-engine/", ""),
        subpath: match[3] ?? null,
        names: ["default"],
      });
    }
  }
  return out;
}

/** 某包的清单元 */
async function packageManifest(
  pkg: string,
): Promise<{ exports?: Record<string, string> } | null> {
  const raw = await readSource(`packages/${pkg}/package.json`);
  return raw === null
    ? null
    : (JSON.parse(raw) as { exports?: Record<string, string> });
}

const IMPORTS = collectImports();

describe("模板与引擎导出面互锁（源级扫描）", () => {
  it("扫描面自检：包出口与模板导入都取到了（glob 失配时立刻失败）", () => {
    const entries = [...LOADERS.keys()].filter((key) =>
      key.endsWith("/src/index.ts"),
    );
    expect(entries.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(TEMPLATE_TEXT).length).toBeGreaterThanOrEqual(60);
    // 模板对引擎的依赖是真实存在的；为 0 说明正则或 glob 失配，判据空跑
    expect(IMPORTS.length).toBeGreaterThanOrEqual(20);
    expect(IMPORTS.some((item) => item.names.length > 0)).toBe(true);
  });

  it("出口解析自检：`export *` 被展开，核心包暴露出会话与存档相关名字", async () => {
    const core = await exportedSurface("packages/core/src/index.ts");
    // 这两个名字都经 `export * from "./contracts/index.ts"` 进来：
    // 若星号转发没被展开，集合只剩包出口那几段 `export { … }`，判据会变得很弱
    expect(core.has("SYS")).toBe(true);
    expect(core.has("SavePort")).toBe(true);
    expect(core.size).toBeGreaterThan(100);
  });

  it("模板里的每个具名导入，都能在对应包的公共出口里找到", async () => {
    const missing: string[] = [];
    const cache = new Map<string, Set<string>>();
    for (const item of IMPORTS) {
      if (item.subpath !== null) continue; // 深度子路径另有一条判据
      const entry = `packages/${item.pkg}/src/index.ts`;
      let surface = cache.get(entry);
      if (surface === undefined) {
        surface = await exportedSurface(entry);
        cache.set(entry, surface);
      }
      if (surface.size === 0) {
        missing.push(
          `${item.file}: 包 @lingfan-engine/${item.pkg} 找不到公共出口`,
        );
        continue;
      }
      for (const name of item.names) {
        if (!surface.has(name)) {
          missing.push(
            `${item.file}: @lingfan-engine/${item.pkg} 没有导出 ${name}`,
          );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("模板里的深度子路径导入，都在该包 exports 映射里登记过", async () => {
    const problems: string[] = [];
    for (const item of IMPORTS) {
      if (item.subpath === null) continue;
      const manifest = await packageManifest(item.pkg);
      if (manifest === null) {
        problems.push(`${item.file}: 包 @lingfan-engine/${item.pkg} 无清单`);
        continue;
      }
      if (manifest.exports?.[`.${item.subpath}`] === undefined) {
        problems.push(
          `${item.file}: @lingfan-engine/${item.pkg} 的 exports 里没有 ".${item.subpath}"`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
