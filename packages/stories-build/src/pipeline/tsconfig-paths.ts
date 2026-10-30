import { dirname, isAbsolute, resolve } from "node:path";
import * as ts from "typescript";

/**
 * 工程 tsconfig 的 `compilerOptions.paths` 读取与展开（构建期，Node 侧）。
 *
 * 别名不是本引擎的规定：作者在工程 `tsconfig.json` 里写什么（`@/*`、`@ui/*`、`~/*`
 * 任意形态），stories-build 就认什么。本文件只做两件事——把工程配置读成结构化形状
 * （`loadPathsConfig`），把一条说明符展开成候选绝对路径（`expandAlias`）。
 *
 * 为什么不借 tsc 的 `matchPatternOrExact` / `tryParsePatterns`：两个函数不在
 * `typescript.d.ts` 的公开面，TypeScript 升级后可能改名或消失（运行期还在，编译期不可见）。
 * 通配匹配本身就是「前缀 + 后缀 + 最长前缀胜出」，自己实现才能长期稳定。读配置仍走公开
 * API（`readConfigFile` + `parseJsonConfigFileContent`）。
 *
 * 注意事项：
 * - 解析顺序不在这里定。调用方按「相对路径 → 引擎包 → 别名 → 不支持外部包」判定，
 *   本文件只回答「这条说明符能展开成哪些绝对路径」。
 * - 不遍历工程目录：解析时把 host 的 `readDirectory` 换成返回空数组，耗时与工程体量无关。
 * - 只有 `paths` 才算别名来源，不做「没配 paths 就按约定猜前缀」的推断。
 * - 目标模板里的 `*` 按命中段替换；`baseDir` 取**声明 paths 的那个 tsconfig 所在目录**
 *   （子级覆盖 ⇒ 子目录，父级声明 ⇒ 父目录）；显式 `baseUrl` 优先按 baseUrl。
 * - `extends` 只跟随相对路径与绝对路径形态；包名形态的 extends 不追（退化为工程根目录），
 *   这类工程很少见且没有可靠的本地解析入口。
 */

/** 工程根 tsconfig 文件名（只读这一个文件，不向上/向下找） */
const TSCONFIG_FILE = "tsconfig.json";

/** 一条 `paths` 条目：通配键拆成前缀 + 后缀，精确键只按字符串全等命中 */
export interface PathsPattern {
  readonly prefix: string;
  readonly suffix: string;
  /** 目标模板（可含 `*`，按声明序） */
  readonly targets: readonly string[];
  /** 键里带 `*` ⇒ 通配模式；否则是精确键 */
  readonly wildcard: boolean;
}

/** 工程 `paths` 的结构化形状：`baseDir` 是目标模板的基准目录（绝对路径） */
export interface PathsConfig {
  readonly patterns: readonly PathsPattern[];
  readonly baseDir: string;
}

/**
 * 读 `root/tsconfig.json` 的 `compilerOptions.paths`。
 * 文件缺失、读不动或没有 `paths` ⇒ `null`（构建退化为纯相对路径，宿主零配置也能跑）。
 */
export function loadPathsConfig(root: string): PathsConfig | null {
  const configPath = resolve(root, TSCONFIG_FILE);
  if (!ts.sys.fileExists(configPath)) return null;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) return null;
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    // 只取配置语义，不看工程里有哪些文件：readDirectory 返回空 = 不遍历目录
    { ...ts.sys, readDirectory: () => [] },
    dirname(configPath),
    undefined,
    configPath,
  );
  const paths = parsed.options.paths;
  if (paths === undefined) return null;
  return {
    patterns: Object.entries(paths).map(([key, targets]) => ({
      ...splitPattern(key),
      targets: [...targets],
    })),
    baseDir:
      parsed.options.baseUrl ?? declaringDir(configPath) ?? dirname(configPath),
  };
}

/**
 * 按最长前缀把一条说明符展开成候选绝对路径（按声明序、去重后返回）。
 * 未命中任何模式 ⇒ 空数组；不探测文件是否存在（存在性由调用方在自己的文件树上判）。
 */
export function expandAlias(
  config: PathsConfig,
  specifier: string,
): readonly string[] {
  const hit = matchPattern(config.patterns, specifier);
  if (hit === undefined) return [];
  const expanded: string[] = [];
  for (const target of hit.pattern.targets) {
    const filled = hit.pattern.wildcard
      ? replaceStar(target, hit.middle)
      : target;
    const absolute = resolve(config.baseDir, filled);
    if (!expanded.includes(absolute)) expanded.push(absolute);
  }
  return expanded;
}

/** 通配键拆前缀/后缀（第一个 `*` 切分，与 tsc 同一套通配语义） */
function splitPattern(key: string): Omit<PathsPattern, "targets"> {
  const star = key.indexOf("*");
  if (star === -1) return { prefix: key, suffix: "", wildcard: false };
  return {
    prefix: key.slice(0, star),
    suffix: key.slice(star + 1),
    wildcard: true,
  };
}

/**
 * 匹配：精确键（无 `*`）先按字符串全等命中；否则在命中的通配模式里取前缀最长的那个。
 * 前缀等长的多个模式按声明序取首个——tsconfig 里同前缀重复声明本身没有意义。
 */
function matchPattern(
  patterns: readonly PathsPattern[],
  specifier: string,
): { pattern: PathsPattern; middle: string } | undefined {
  let exact: PathsPattern | undefined;
  let best: { pattern: PathsPattern; middle: string } | undefined;
  for (const pattern of patterns) {
    if (!pattern.wildcard) {
      if (pattern.prefix === specifier) exact = pattern;
      continue;
    }
    const fixed = pattern.prefix.length + pattern.suffix.length;
    if (specifier.length < fixed) continue;
    if (!specifier.startsWith(pattern.prefix)) continue;
    if (!specifier.endsWith(pattern.suffix)) continue;
    if (
      best !== undefined &&
      pattern.prefix.length <= best.pattern.prefix.length
    )
      continue;
    best = {
      pattern,
      middle: specifier.slice(
        pattern.prefix.length,
        specifier.length - pattern.suffix.length,
      ),
    };
  }
  if (exact !== undefined) return { pattern: exact, middle: "" };
  return best;
}

/** 目标模板里的 `*` 全部替换成命中段（tsc 语义：模板里的每个 `*` 都填同一个值） */
function replaceStar(target: string, middle: string): string {
  return target.includes("*") ? target.split("*").join(middle) : target;
}

/**
 * 声明 `compilerOptions.paths` 的那个 tsconfig 所在目录：先看自身，再沿 `extends`
 * 反向遍历（数组形态下后者覆盖前者）。找不到 ⇒ `null`（调用方退化为工程根目录）。
 */
function declaringDir(
  configPath: string,
  seen = new Set<string>(),
): string | null {
  if (seen.has(configPath)) return null;
  seen.add(configPath);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) return null;
  const json = read.config as
    { compilerOptions?: { paths?: unknown }; extends?: unknown } | undefined;
  if (json?.compilerOptions?.paths !== undefined) return dirname(configPath);
  const parents = extendsList(json?.extends);
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parentPath = resolveExtends(parents[index]!, dirname(configPath));
    if (parentPath === null) continue;
    const found = declaringDir(parentPath, seen);
    if (found !== null) return found;
  }
  return null;
}

/** `extends` 的取值形态：单条字符串或字符串数组（非字符串项忽略） */
function extendsList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** 相对/绝对路径形态的 extends 解析成实际文件名；包名形态 ⇒ null（不追） */
function resolveExtends(specifier: string, fromDir: string): string | null {
  const looksLocal =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    isAbsolute(specifier);
  if (!looksLocal) return null;
  const base = resolve(fromDir, specifier);
  for (const candidate of [
    base,
    `${base}.json`,
    resolve(base, TSCONFIG_FILE),
  ]) {
    if (ts.sys.fileExists(candidate)) return candidate;
  }
  return null;
}
