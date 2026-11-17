/**
 * i18n 创作期 CLI（lingfan-i18n）· 薄入口：参数解析 → 纯函数 → 打印。
 *
 * 三层分离：业务逻辑全在 ../i18n/** 纯函数（扫描/归属/落位/增量/对账/覆盖率）；
 * IO 接线（读 Lang/ 与源码、写骨架）在 ./i18n-io.ts；本文件只做编排 + 打印，
 * 零 node:* 导入，留在核心层守卫内（bin 垫片经 tsx 装载本入口）。
 *
 * 退出码：0 = 成功；1 = check 失败或 IO 失败；2 = 参数错误。
 * scan = 键清单（不读 overlay、不写盘）；skeleton = 生成/更新骨架（写盘，幂等：
 * 内容未变不触碰文件）；report = 对账报告（不写盘）；check = 与 report 同源数据 +
 * 按 --fail-on 给退出码（any = 缺译/孤儿键/未标记静态文案三者任一）。
 * 故事面只读编译产物（不扫故事源码）；宿主面扫源码，别名清单缺省 ["t"]。
 */

import {
  coveragePercentOf,
  coverageWeightedPercentOf,
  findLayoutConflicts,
  formatI18nDiagnostics,
  formatLayoutConflicts,
  formatTranslationReport,
  formatUnmarkedTexts,
  formatUnplannedOrphans,
  langCoverage,
  layoutKeySetsConsistent,
  mergeOverlayView,
  planOverlaySkeleton,
  prunedOverlayKeys,
  reconcileTranslations,
  unplannedOrphanKeys,
  type LangCoverage,
  type LayoutConflict,
} from "../i18n/index.ts";
import { parseI18nArgs, type I18nCliArgs } from "./args.ts";
import {
  discoverLangs,
  loadContext,
  loadExisting,
  overlayFilesOf,
  writeOverlayIfChanged,
  type CliContext,
} from "./i18n-io.ts";

/** 输出端口（测试注入收集行；缺省进程 stdout/stderr） */
export interface I18nCliOutput {
  log(line: string): void;
  error(line: string): void;
}

const consoleOutput: I18nCliOutput = {
  log: (line) => process.stdout.write(`${line}\n`),
  error: (line) => process.stderr.write(`${line}\n`),
};

interface LangDiagnostics {
  lang: string;
  missing: readonly string[];
  unused: readonly string[];
  conflicts: LayoutConflict[];
  coverage: LangCoverage;
}

async function diagnoseLang(
  args: I18nCliArgs,
  ctx: CliContext,
  lang: string,
): Promise<LangDiagnostics> {
  const existing = await loadExisting(ctx.resourcesRoot, lang, args.layout);
  const files = overlayFilesOf(existing, lang, args.layout);
  const merged = mergeOverlayView(files);
  const report = reconcileTranslations(ctx.sources, { [lang]: merged.keys });
  return {
    lang,
    missing: report.missingByLang.get(lang) ?? [],
    unused: report.unused,
    conflicts: findLayoutConflicts(files),
    coverage: langCoverage(ctx.sources, lang, merged.keys),
  };
}

function coverageLine(c: LangCoverage): string {
  return `[${c.lang}] 覆盖率 ${coveragePercentOf(c)}（字数加权 ${coverageWeightedPercentOf(c)}，${c.translated}/${c.total} 键）`;
}

function coverageJson(c: LangCoverage): Record<string, number> {
  return {
    total: c.total,
    translated: c.translated,
    missing: c.missing.length,
    unused: c.unused.length,
    ratio: c.ratio,
    weightedRatio: c.weightedRatio,
  };
}

function runScan(args: I18nCliArgs, ctx: CliContext, out: I18nCliOutput): number {
  let storyTotal = 0;
  for (const keys of ctx.storyKeys.values()) storyTotal += keys.length;
  let hostTotal = 0;
  for (const keys of ctx.host.hostKeys.values()) hostTotal += keys.length;
  if (args.json) {
    out.log(
      JSON.stringify(
        {
          storyKeys: Object.fromEntries(ctx.storyKeys),
          hostKeys: Object.fromEntries(ctx.host.hostKeys),
          dynamic: ctx.host.dynamic,
          unmarked: ctx.host.unmarked,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  out.log(`故事键 ${storyTotal} 条（${ctx.storyKeys.size} 个编译产物）`);
  out.log(`宿主键 ${hostTotal} 条（${ctx.host.hostKeys.size} 个源文件）`);
  if (ctx.host.dynamic.length === 0) {
    out.log("动态调用点 0 处（登记调用首参均为字面量）");
  } else {
    out.log(
      `动态调用点 ${ctx.host.dynamic.length} 处（首参非字面量，无法静态收键）：`,
    );
    for (const site of ctx.host.dynamic) {
      out.log(`  - ${site.file}:${site.line}:${site.column} ${site.callee}()`);
    }
  }
  out.log(formatUnmarkedTexts(ctx.host.unmarked));
  return 0;
}

async function runSkeleton(
  args: I18nCliArgs,
  ctx: CliContext,
  out: I18nCliOutput,
): Promise<number> {
  const lang = args.lang;
  if (lang === undefined) {
    out.error("skeleton 需要 --lang=<语言代码>");
    return 2;
  }
  const existing = await loadExisting(ctx.resourcesRoot, lang, args.layout);
  const files = planOverlaySkeleton({
    lang,
    layout: args.layout,
    storyKeys: ctx.storyKeys,
    hostKeys: ctx.host.hostKeys,
    existing,
    placeholder: args.placeholder,
    prune: args.prune,
  });
  let written = 0;
  const jsonFiles: { path: string; entries: Record<string, string>; written: boolean }[] = [];
  const prunedAll: { path: string; keys: string[] }[] = [];
  for (const file of files) {
    const changed = await writeOverlayIfChanged(
      ctx.resourcesRoot,
      file.path,
      file.content,
    );
    if (changed) written += 1;
    jsonFiles.push({ path: file.path, entries: file.entries, written: changed });
    if (args.prune) {
      const prior = existing.get(file.path) ?? {};
      const keys = prunedOverlayKeys(Object.keys(file.entries), Object.keys(prior));
      if (keys.length > 0) prunedAll.push({ path: file.path, keys });
    }
  }
  const unplanned = args.prune
    ? unplannedOrphanKeys(existing, files.map((file) => file.path), ctx.sources)
    : [];
  if (args.json) {
    const payload = {
      files: jsonFiles,
      pruned: prunedAll,
      unplannedOrphans: unplanned,
    };
    out.log(JSON.stringify(payload, null, 2));
    return 0;
  }
  out.log(`骨架 ${files.length} 个文件（写入 ${written}，未变 ${files.length - written}）`);
  for (const item of prunedAll) {
    out.log(`删除孤儿键 ${item.keys.length} 条（${item.path}）：`);
    for (const key of item.keys) out.log(`  - ${key}`);
  }
  if (unplanned.length > 0) out.log(formatUnplannedOrphans(unplanned));
  return 0;
}

async function runReport(
  args: I18nCliArgs,
  ctx: CliContext,
  out: I18nCliOutput,
): Promise<number> {
  const lang = args.lang;
  if (lang === undefined) {
    out.error("report 需要 --lang=<语言代码>");
    return 2;
  }
  const diag = await diagnoseLang(args, ctx, lang);
  if (args.json) {
    out.log(
      JSON.stringify(
        {
          lang,
          missing: diag.missing,
          unused: diag.unused,
          unmarked: ctx.host.unmarked,
          conflicts: diag.conflicts,
          coverage: coverageJson(diag.coverage),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  out.log(
    formatTranslationReport({
      missingByLang: new Map([[lang, diag.missing]]),
      unused: diag.unused,
    }),
  );
  out.log(
    formatI18nDiagnostics({ unmarked: ctx.host.unmarked, conflicts: diag.conflicts }),
  );
  out.log(coverageLine(diag.coverage));
  return 0;
}

async function runCheck(
  args: I18nCliArgs,
  ctx: CliContext,
  out: I18nCliOutput,
): Promise<number> {
  const langs =
    args.lang !== undefined ? [args.lang] : await discoverLangs(ctx.resourcesRoot);
  const diags: LangDiagnostics[] = [];
  for (const lang of langs) diags.push(await diagnoseLang(args, ctx, lang));
  const consistent = layoutKeySetsConsistent({
    lang: args.lang ?? langs[0] ?? "en",
    storyKeys: ctx.storyKeys,
    hostKeys: ctx.host.hostKeys,
  });
  const anyMissing = diags.some((d) => d.missing.length > 0);
  const anyUnused = diags.some((d) => d.unused.length > 0);
  const anyUnmarked = ctx.host.unmarked.length > 0;
  const failed =
    args.failOn === "missing"
      ? anyMissing
      : args.failOn === "unused"
        ? anyUnused
        : anyMissing || anyUnused || anyUnmarked;
  if (args.json) {
    out.log(
      JSON.stringify(
        {
          langs: diags.map((d) => ({
            lang: d.lang,
            missing: d.missing,
            unused: d.unused,
            conflicts: d.conflicts,
            coverage: coverageJson(d.coverage),
          })),
          unmarked: ctx.host.unmarked,
          layoutConsistent: consistent,
          failOn: args.failOn,
          passed: !failed,
        },
        null,
        2,
      ),
    );
    return failed ? 1 : 0;
  }
  if (langs.length === 0) out.log("未发现任何 overlay（Lang/ 为空或不存在）");
  for (const diag of diags) {
    out.log(
      formatTranslationReport({
        missingByLang: new Map([[diag.lang, diag.missing]]),
        unused: diag.unused,
      }),
    );
    out.log(formatLayoutConflicts(diag.conflicts));
    out.log(coverageLine(diag.coverage));
  }
  out.log(formatUnmarkedTexts(ctx.host.unmarked));
  out.log(`三布局键集合一致性：${consistent ? "通过" : "不一致"}（只报告，不阻断）`);
  out.log(failed ? `check 失败（fail-on=${args.failOn}）` : "check 通过");
  return failed ? 1 : 0;
}

/**
 * CLI 入口（bin 垫片调用）：argv 不含 node/脚本名。
 * 参数错误 → 2；IO 失败 / check 失败 → 1；其余 → 0。
 */
export async function runI18nCli(
  argv: readonly string[],
  output: I18nCliOutput = consoleOutput,
): Promise<number> {
  let args: I18nCliArgs;
  try {
    args = parseI18nArgs(argv, {
      envRoot: process.env.DSH_I18N_ROOT,
      cwd: process.cwd(),
    });
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  try {
    const ctx = await loadContext(args);
    switch (args.command) {
      case "scan":
        return runScan(args, ctx, output);
      case "skeleton":
        return await runSkeleton(args, ctx, output);
      case "report":
        return await runReport(args, ctx, output);
      case "check":
        return await runCheck(args, ctx, output);
      default:
        return 2;
    }
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}