/**
 * 生成编排：读模板 → 合叠加层 → 落版本 → 替换占位符 → 写盘。
 *
 * 顺序是有依赖的，不能互换：
 * 1. 合并拿到完整文件表（叠加层已覆盖骨架的同名文件）；
 * 2. 把 `package.patch.json` 的增量深合进 `package.json`，并在此之上写版本号——
 *    叠加层新增的依赖也要被解析到最新版，所以版本注入必须发生在合并之后；
 * 3. 最后做占位符替换，产物文本因此与磁盘上写出的字节完全一致。
 *
 * 写盘是「全有或全无」的：先算出全部产物再逐个写，中途不会因为某个文件失败而留下半个工程。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  listFiles,
  mergeLayers,
  PATCH_SUFFIX,
  type PendingFile,
} from "../overlay/index.ts";
import {
  applyResolvedVersions,
  overlayDirOf,
  readTemplateMeta,
} from "../registry/index.ts";
import { replaceInFile } from "./replace.ts";
import { restoreDotfile } from "./dotfiles.ts";

/** 骨架目录名：占位符本身，也是模板里唯一随框架无关的目录 */
export const SKELETON_DIR = "__PROJECT__";

/** 生成参数 */
export interface GenerateOptions {
  /** 模板根目录（含 `template-meta.json` 与骨架目录） */
  readonly templateRoot: string;
  /** 生成到哪个目录下 */
  readonly targetBase: string;
  /** 工程名：目录名、包名、清单 id 与页面标题都用它 */
  readonly projectName: string;
  /** 框架叠加层 id */
  readonly framework: string;
  /** 壳叠加层 id */
  readonly shell: string;
  /**
   * 故事源形态叠加层 id；缺省 `story`（直接写故事文件）。
   *
   * 可选是为了不破坏既有调用方——只关心框架与壳的代码不必为一个用不到的参数改签名。
   */
  readonly sources?: string;
  /** 引擎包的最新版本；缺席项沿用模板记录的值 */
  readonly resolved: ReadonlyMap<string, string>;
}

/** 生成结果 */
export interface GenerateResult {
  /** 生成出来的工程根目录绝对路径 */
  readonly projectDir: string;
  /** 写出的文件数 */
  readonly fileCount: number;
  /** 实际采用的框架、壳与故事源形态 */
  readonly framework: string;
  readonly shell: string;
  readonly sources: string;
}

/** 故事源形态的缺省 id：不叠加任何层，直接用骨架自带的故事文件 */
export const DEFAULT_SOURCES = "story";

/**
 * 生成一个工程。
 *
 * 只会新建目录：目标已存在且非空时抛错，不做覆盖也不做增量合并——覆盖别人的工程
 * 无法撤销，宁可让使用者先自己删。
 */
export function generateProject(options: GenerateOptions): GenerateResult {
  const meta = readTemplateMeta(options.templateRoot);
  const projectDir = join(options.targetBase, options.projectName);
  if (isOccupied(projectDir)) {
    throw new Error(`目标目录已存在且非空：${projectDir}`);
  }
  const merged = mergeLayers(layerBases(options));
  const files = finalize(
    merged.files,
    merged.patch,
    options.resolved,
    meta.placeholder,
    options.projectName,
  );
  mkdirSync(projectDir, { recursive: true });
  for (const file of files) {
    const target = join(projectDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  return {
    projectDir,
    fileCount: files.length,
    framework: options.framework,
    shell: options.shell,
    sources: options.sources ?? DEFAULT_SOURCES,
  };
}

/**
 * 依次列出要合并的目录：骨架在前，框架层次之，故事源形态层再次，壳层最后。
 *
 * 顺序有实际后果，不是随便排的：
 * - 故事源形态层要晚于框架层——它替换 `src/stories.ts`，而各框架入口都从那里取表，
 *   晚于框架层才能覆盖到「框架层是否也带了自己的 stories.ts」这类情况；
 * - 壳层最后——壳对工程形态有最终发言权（小程序壳会删掉浏览器宿主的 `src/host/`），
 *   让它压过其余各层才不会出现「壳删了、下层又写回来」。
 *
 * 缺席的叠加层直接跳过——缺省项（`none` / `browser` / `story`）本就没有目录，
 * 这不是错误，只是「这一层什么都不加」。
 */
export function layerBases(options: GenerateOptions): string[] {
  const bases = [join(options.templateRoot, SKELETON_DIR)];
  const ids = unique([
    options.framework,
    options.sources ?? DEFAULT_SOURCES,
    options.shell,
  ]);
  for (const id of ids) {
    const dir = overlayDirOf(options.templateRoot, id);
    if (dir !== undefined && !bases.includes(dir)) bases.push(dir);
  }
  return bases;
}

/** 目标目录是否已被占用：存在且含有内容即算占用，空目录可以复用 */
function isOccupied(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir).length > 0;
}

/**
 * 收集这些层里出现过的依赖名。
 *
 * 只读 `package.json` 与根目录的 `*.patch.json`：前者是骨架写的依赖，后者是叠加层
 * 追加的依赖，两处之外不会有依赖声明。顺序去重，供版本查询一次问完。
 */
export function collectDependencyNames(bases: readonly string[]): string[] {
  const names = new Set<string>();
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const path of listFiles(base)) {
      const isManifest = path === "package.json";
      const isPatch = !path.includes("/") && path.endsWith(PATCH_SUFFIX);
      if (!isManifest && !isPatch) continue;
      const parsed = JSON.parse(
        readFileSync(join(base, path), "utf8"),
      ) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies"] as const) {
        const table = parsed[field];
        if (isStringMap(table)) {
          for (const name of Object.keys(table)) names.add(name);
        }
      }
    }
  }
  return [...names];
}

/**
 * 收尾：工程清单合并版本、点文件名还原、全部文件替换占位符。
 *
 * 单独拆出来是为了可测——测试要能在不写盘的前提下断言产物字节，
 * 写盘那一步与「算出该写什么」分开后，判据就不必碰真实文件系统。
 *
 * 点文件还原必须在这里发生：模板里存的是躲开 npm 改名的普通名（见 `dotfiles.ts`），
 * 产物路径要写回带点的形态，占位符替换才按产物路径判文本/二进制。
 */
export function finalize(
  files: readonly PendingFile[],
  patch: Readonly<Record<string, unknown>> | undefined,
  resolved: ReadonlyMap<string, string>,
  placeholder: string,
  projectName: string,
): PendingFile[] {
  return files.map((file) => {
    const path = restoreDotfile(file.path);
    const content =
      file.path === "package.json"
        ? renderManifest(file.content, patch, resolved)
        : file.content;
    return {
      path,
      content: replaceInFile(path, content, placeholder, projectName),
    };
  });
}

/**
 * 把增量与版本号写进 `package.json`。
 *
 * 依赖表只改「已经存在的键」：模板决定依赖集合，生成器不是包管理器，
 * 不会凭 registry 上的存在性往工程里塞新包。叠加层 `create.pinned` 点名的包
 * 不参与版本解析，保留模板记录的区间——上游版本兼容性只有模板作者知道。
 */
function renderManifest(
  content: Buffer,
  patch: Readonly<Record<string, unknown>> | undefined,
  resolved: ReadonlyMap<string, string>,
): Buffer {
  const manifest = JSON.parse(content.toString("utf8")) as Record<
    string,
    unknown
  >;
  const withPatch =
    patch === undefined ? manifest : mergeManifest(manifest, patch);
  delete withPatch[CREATE_FIELD];
  const pinned = new Set(pinnedNames(patch));
  for (const field of ["dependencies", "devDependencies"] as const) {
    const table = withPatch[field];
    if (isStringMap(table)) {
      withPatch[field] = applyResolvedVersions(
        table,
        withoutNames(resolved, pinned),
      );
    }
  }
  return Buffer.from(`${JSON.stringify(withPatch, null, 2)}\n`, "utf8");
}

/** 去掉被钉住的包：它们不进解析结果表，版本区间因此保持模板原值 */
function withoutNames(
  resolved: ReadonlyMap<string, string>,
  names: ReadonlySet<string>,
): Map<string, string> {
  if (names.size === 0) return new Map(resolved);
  const out = new Map<string, string>();
  for (const [name, version] of resolved) {
    if (!names.has(name)) out.set(name, version);
  }
  return out;
}

/** 顶层深合并：嵌套对象递归，其余（含数组）由增量整体取代 */
function mergeManifest(
  base: Record<string, unknown>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] =
      isStringMap(current) && isStringMap(value)
        ? { ...current, ...value }
        : value;
  }
  return out;
}

/**
 * 生成器专用字段名。
 *
 * 叠加层可以用它声明「生成期要做的事」，这些内容不属于产物清单，写盘前必须抹掉——
 * 否则新工程的 `package.json` 里会多出一个 npm 不认识、读者也不懂的字段。
 */
const CREATE_FIELD = "create";

/**
 * 读叠加层声明的「不要跟最新版」的依赖名。
 *
 * 存在的理由：模板希望依赖尽量新，但上游并非都兼容——`vue-tsc` 在 `typescript` 7 上
 * 会因 `./lib/tsc` 不再导出而直接崩，这类约束只有模板作者知道。钉住的包保留模板
 * 记录的版本区间，其余照常解析到最新。
 */
export function pinnedNames(
  patch: Readonly<Record<string, unknown>> | undefined,
): string[] {
  if (patch === undefined) return [];
  const section = patch[CREATE_FIELD];
  if (!isPlainRecord(section)) return [];
  const pinned = section.pinned;
  if (!Array.isArray(pinned)) return [];
  return pinned.filter((item): item is string => typeof item === "string");
}

/** 只认普通对象：数组与 null 不算 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只认「字符串到字符串」的表：依赖就是这个形状 */
function isStringMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

/** 去重但保序：框架与壳偶有同名层（如都用 browser），只要合并一次 */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
