/**
 * 创作期增量监听（`pnpm stories:watch`）：常驻进程内监听源目录变更，防抖合并后
 * 重跑 `buildStories`。编译始终全量——不引入第二套编译规则，任何一轮的产物都与
 * `stories:build` 一致；差量落盘由 `emitArtifacts` 完成。
 *
 * `affectedStories` 提供改动的波及面报告（反向依赖闭包），仅用于日志呈现，
 * 不参与编译。
 */
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { RESOURCES_DIR } from "@lingfan-engine/core";
import { DEFAULT_SOURCES_DIR, buildStories } from "./index.ts";
import type { StoryBuildOptions } from "./orchestrate.ts";
import { GEN_PREFIX, walkFiles } from "../shared/index.ts";

/** 相对导入抽取（单双引号皆可；type 导入同算依赖——保守向） */
const REL_IMPORT_RE = /(?:^|[\s;])from\s+["'](\.{1,2}\/[^"']+)["']/g;

/**
 * 从一段 TS 源文本抽取相对导入说明符（去扩展名与 /index 后缀的规范化模块路径，
 * 与图谱层的模块键同形）。
 */
function extractRelImports(text: string): string[] {
  const specs: string[] = [];
  for (const match of text.matchAll(REL_IMPORT_RE)) {
    specs.push(match[1]!);
  }
  return specs;
}

/** 规范化相对说明符 → 模块键（`./a/b` → `a/b`、`../lib/x.ts` → `lib/x`、`./x/index` → `x`） */
function normalizeSpec(spec: string, fromDir: string): string {
  const parts = `${fromDir}/${spec}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  let key = out.join("/");
  key = key.replace(/\.ts$/, "").replace(/\/index$/, "");
  return key;
}

/**
 * 反向依赖闭包：给「改动文件集合」求「受影响的故事文件集合」。
 * 输入 = 全部源文件文本（相对工程根 posix 路径 → 文本，含 Stories.src/config.ts）；
 * 闭包沿「谁导入了我」逐层展开，只有命中故事文件（default 导出列）才算受影响列。
 */
export function affectedStories(
  changed: readonly string[],
  sourceTexts: ReadonlyMap<string, string>,
): string[] {
  // 模块键 → 文件 posix 相对路径（config.ts 与故事/模块文件都进索引）
  const byModuleKey = new Map<string, string>();
  for (const rel of sourceTexts.keys()) {
    const normalized = rel.replace(/\.ts$/, "").replace(/\/index$/, "");
    byModuleKey.set(normalized, rel);
  }
  // 反向边：模块键 → 直接引用它的文件集合
  const importers = new Map<string, Set<string>>();
  for (const [rel, text] of sourceTexts) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    for (const spec of extractRelImports(text)) {
      const key = normalizeSpec(spec, dir);
      const target = byModuleKey.get(key);
      if (target === undefined) continue;
      const set = importers.get(target);
      if (set === undefined) importers.set(target, new Set([rel]));
      else set.add(rel);
    }
  }
  // 故事文件判据：default export function（与 story-compiler 的故事形态对齐）
  const storyOf = new Map<string, string>();
  for (const [rel, text] of sourceTexts) {
    if (/export\s+default\s+function\s+\w/.test(text)) storyOf.set(rel, rel);
  }
  const affected = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const rel = queue.pop()!;
    if (affected.has(rel)) continue;
    affected.add(rel);
    for (const importer of importers.get(rel) ?? []) {
      queue.push(importer);
    }
  }
  return [...affected].filter((rel) => storyOf.has(rel)).sort();
}

/** `watchStories` 的可配置项：在 `StoryBuildOptions` 之上只加监听节奏两旋钮。 */
export interface WatchStoriesOptions extends StoryBuildOptions {
  /** 变更后合并再编译的等待毫秒数（缺省 150） */
  readonly debounceMs?: number;
  /** 轮间打印回调（缺省 console.log；可注入收集器静默） */
  readonly log?: (message: string) => void;
}

/** 一次变更轮的结果：产物差量 + 受影响故事集 */
export interface WatchRoundReport {
  /** 本轮产物差量（相对上一轮落盘状态；语义同 `BuildReport.added/updated/removed`） */
  added: string[];
  updated: string[];
  removed: string[];
  /** 本轮改动波及的故事源（反向依赖闭包，仅呈现） */
  affectedStories: string[];
  /** 本轮是否编译成功（失败时 added/updated/removed 为空数组） */
  ok: boolean;
}

/** 源树与字体目录的监听目标（相对工程根） */
const WATCHED_FONT_DIR = join(RESOURCES_DIR, "Fonts");

/**
 * 常驻增量监听入口：首轮全量构建落基准 → `fs.watch` 监听源目录（与字体目录，
 * 存在才挂）→ 变更防抖后进程内重跑 `buildStories` 并把差量与受影响故事集交给
 * 回调/日志。返回停止函数（关 watcher、落当前任务）；失败轮不终止监听——
 * 下一次改动照常重试（创作期半成品常态）。
 */
export async function watchStories(
  root: string,
  options: WatchStoriesOptions = {},
): Promise<() => void> {
  const log = options.log ?? ((message: string) => console.log(message));
  const debounceMs = options.debounceMs ?? 150;
  const sourcesDir = resolve(root, options.sourcesDir ?? DEFAULT_SOURCES_DIR);
  const fontsDir = resolve(root, WATCHED_FONT_DIR);

  // 首轮：全量构建落基准
  try {
    const report = await buildStories(root, options);
    log(firstRoundLine(report));
  } catch (error) {
    log(`[stories:watch] 首轮构建失败：${errorText(error)}`);
    log("[stories:watch] 监听中——修复后保存即重试。");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let rerun = false;
  // 变更文件集合（防抖窗口内累计；"rename"/目录级事件给不准路径时退化为全源扫描）
  let pending = new Set<string>();

  const runRound = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    const changed = [...pending];
    pending = new Set();
    try {
      const sourceTexts = readSourceTexts(root, options);
      const affected = affectedStories(changed, sourceTexts);
      const report = await buildStories(root, options);
      log(roundLine(report, affected));
    } catch (error) {
      log(`[stories:watch] 本轮构建失败（监听继续）：${errorText(error)}`);
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void runRound();
      }
    }
  };

  const schedule = (relPath: string | undefined): void => {
    if (relPath !== undefined && relPath !== "") pending.add(relPath);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runRound();
    }, debounceMs);
  };

  const watchers: ReturnType<typeof watch>[] = [];
  // filename 相对监听目录；prefix 归一成与 readSourceTexts 键同型的工程相对路径
  const mount = (dir: string, prefix: string): void => {
    try {
      const w = watch(dir, { recursive: true }, (_event, filename) => {
        // filename 为 null = 平台给不准路径，退化记录哨兵（全源扫描）
        const rel = filename === null ? undefined : String(filename);
        schedule(
          rel === undefined ? undefined : `${prefix}${rel.replace(/\\/g, "/")}`,
        );
      });
      watchers.push(w);
    } catch {
      // 目录不存在（如 Fonts 未建）——跳过，不阻塞监听主目标
    }
  };
  mount(sourcesDir, `${options.sourcesDir ?? DEFAULT_SOURCES_DIR}/`);
  mount(fontsDir, `${WATCHED_FONT_DIR}/`);

  return () => {
    for (const w of watchers) w.close();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** 读取源文本快照：源树全部 .ts 文本（跳生成物目录），posix 相对路径 → 文本 */
function readSourceTexts(
  root: string,
  options: StoryBuildOptions,
): Map<string, string> {
  const sourcesDirName = options.sourcesDir ?? DEFAULT_SOURCES_DIR;
  const sourcesDir = resolve(root, sourcesDirName);
  const texts = new Map<string, string>();
  for (const [rel, text] of walkFiles(sourcesDir)) {
    const posix = rel.replace(/\\/g, "/");
    if (posix.startsWith(GEN_PREFIX) || !posix.endsWith(".ts")) continue;
    texts.set(`${sourcesDirName}/${posix}`, text);
  }
  return texts;
}

function firstRoundLine(report: { storyId: string; columns: number }): string {
  return `首轮构建完成：story "${report.storyId}"（${report.columns} 列），监听中——保存即重编译。`;
}

function roundLine(
  report: { added: string[]; updated: string[]; removed: string[] },
  affected: readonly string[],
): string {
  const parts: string[] = [];
  const total =
    report.added.length + report.updated.length + report.removed.length;
  if (total === 0) {
    parts.push("产物零差量");
  } else {
    if (report.added.length > 0) parts.push(`新增 ${report.added.length}`);
    if (report.updated.length > 0) parts.push(`更新 ${report.updated.length}`);
    if (report.removed.length > 0) parts.push(`清理 ${report.removed.length}`);
  }
  const affectedLabel =
    affected.length === 0
      ? "—"
      : affected.map((rel) => rel.replace(/\.ts$/, "")).join("、");
  return `监听轮完成（${parts.join("，")}）；波及故事：${affectedLabel}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
