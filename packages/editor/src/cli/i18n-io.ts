/**
 * i18n 创作期 CLI · IO 接线层（Node 侧创作期工具，tsx 运行）。
 *
 * 三层分离的 IO 半边：读编译产物/宿主源码/既有 overlay、写骨架文件。
 * 业务逻辑全在 ../i18n/** 纯函数（本文件只搬运字节与路径，不做判定）；
 * 编排与打印归 ./i18n-cli.ts（零 node:* 导入，留在核心层守卫内）。
 * 与 script/generate-vocabulary.ts 同构：Node 侧工具，不进浏览器产物。
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import { parseStoryFile } from "@lingfan-engine/core";
import {
  extractStoryKeys,
  LANG_DIR,
  MAIN_OVERLAY_FILE,
  type SkeletonLayout,
  type UnmarkedHostText,
} from "../i18n/index.ts";
import {
  findUnmarkedHostTexts,
  isScannableSourcePath,
  scanHostSource,
  type DynamicCallSite,
} from "../scan/index.ts";
import type { I18nCliArgs } from "./args.ts";

/** 递归枚举目录下文件（相对路径、`/` 分隔、排序）；目录不存在返回 [] */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** 故事面：读编译产物，键 = 相对 Stories/ 路径去扩展名（与 columnStoryKey 同口径） */
async function loadStoryKeys(
  storiesDir: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const rel of await listFiles(storiesDir)) {
    // .json.enc 是加密供给形态，创作期 CLI 只读明文
    if (!rel.endsWith(".json")) continue;
    const text = await fsp.readFile(path.join(storiesDir, rel), "utf8");
    // 经 core parseStoryFile 正规化（唯一解析点）：编译产物是单列原子形态
    // （顶层 {formatVersion,id,kind,commands}，无 columns），直喂 extractStoryKeys
    // 会恒得 []；非法 JSON / 形状不符在此显式抛错（StoryFormatError 带文件名）
    const story = parseStoryFile(text, rel);
    map.set(rel.slice(0, -".json".length), extractStoryKeys(story));
  }
  return map;
}

export interface HostScan {
  hostKeys: Map<string, string[]>;
  dynamic: (DynamicCallSite & { file: string })[];
  unmarked: UnmarkedHostText[];
}

/** 宿主面：扫源码收键 + 动态调用点 + 未标记文案；归属映射输入 = 工程内相对路径 */
async function loadHostScan(
  root: string,
  scanDir: string,
  all: boolean,
): Promise<HostScan> {
  const scan: HostScan = { hostKeys: new Map(), dynamic: [], unmarked: [] };
  for (const rel of await listFiles(path.join(root, scanDir))) {
    if (!isScannableSourcePath(rel)) continue;
    const file = `${scanDir}/${rel}`;
    const text = await fsp.readFile(path.join(root, scanDir, rel), "utf8");
    const result = scanHostSource(text, file, { all });
    // 无键的源文件不建宿主分组（避免产出空 overlay 文件）
    if (result.keys.length > 0) scan.hostKeys.set(file, result.keys);
    for (const site of result.dynamic) scan.dynamic.push({ file, ...site });
    for (const site of findUnmarkedHostTexts(text, file)) {
      scan.unmarked.push({ file, ...site });
    }
  }
  return scan;
}

/** 读某语言既有 overlay（键 = 相对资源根路径）；非字符串值 = 文件整体无效，fail-closed */
export async function loadExisting(
  resourcesRoot: string,
  lang: string,
  layout: SkeletonLayout,
): Promise<Map<string, Record<string, string>>> {
  const existing = new Map<string, Record<string, string>>();
  const readEntries = async (rel: string): Promise<void> => {
    const text = await readTextIfExists(path.join(resourcesRoot, rel));
    if (text === undefined) return;
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`overlay 文件不是键值对象：${rel}`);
    }
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`overlay 文件含非字符串值（整体无效）：${rel} 键 ${key}`);
      }
      entries[key] = value;
    }
    existing.set(rel, entries);
  };
  if (layout === "single") {
    await readEntries(`${LANG_DIR}/${lang}.json`);
    return existing;
  }
  const dir = `${LANG_DIR}/${lang}`;
  for (const rel of await listFiles(path.join(resourcesRoot, dir))) {
    if (rel.endsWith(".json")) await readEntries(`${dir}/${rel}`);
  }
  return existing;
}

/** 既有 overlay → 合并视图输入（路径相对 Lang/{lang}/；single 形态归一为 main.json） */
export function overlayFilesOf(
  existing: ReadonlyMap<string, Record<string, string>>,
  lang: string,
  layout: SkeletonLayout,
): I18nOverlayFile[] {
  const prefix = `${LANG_DIR}/${lang}/`;
  return [...existing].map(([fullPath, entries]) => ({
    path: layout === "single" ? MAIN_OVERLAY_FILE : fullPath.slice(prefix.length),
    entries,
  }));
}

/** 从 Lang/ 现状发现语言（顶层 {lang}.json = single 形态；子目录名 = 目录形态） */
export async function discoverLangs(resourcesRoot: string): Promise<string[]> {
  const langs = new Set<string>();
  for (const rel of await listFiles(path.join(resourcesRoot, LANG_DIR))) {
    const segments = rel.split("/");
    if (segments.length === 1 && rel.endsWith(".json")) {
      langs.add(rel.slice(0, -".json".length));
    } else if (segments.length > 1) {
      langs.add(segments[0]);
    }
  }
  return [...langs].sort();
}

export interface CliContext {
  resourcesRoot: string;
  storyKeys: Map<string, string[]>;
  host: HostScan;
  sources: string[];
}

/** 装载一次工程上下文（故事键 + 宿主扫描 + 原文并集），四个子命令共用 */
export async function loadContext(args: I18nCliArgs): Promise<CliContext> {
  const root = path.resolve(args.root);
  const resourcesDir = args.resourcesDir ?? "Resources";
  const storiesDir = args.storiesDir ?? `${resourcesDir}/Stories`;
  const scanDir = (args.scanDir ?? "src").replace(/\\/g, "/");
  const storyKeys = await loadStoryKeys(path.join(root, storiesDir));
  const host = await loadHostScan(root, scanDir, args.all);
  const union = new Set<string>();
  for (const keys of storyKeys.values()) for (const key of keys) union.add(key);
  for (const keys of host.hostKeys.values()) {
    for (const key of keys) union.add(key);
  }
  return {
    resourcesRoot: path.join(root, resourcesDir),
    storyKeys,
    host,
    sources: [...union].sort(),
  };
}

/** 写骨架文件（幂等：内容与磁盘一致则不触碰文件）；返回是否发生写入 */
export async function writeOverlayIfChanged(
  resourcesRoot: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const target = path.join(resourcesRoot, relPath);
  const before = await readTextIfExists(target);
  if (before === content) return false;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
  return true;
}