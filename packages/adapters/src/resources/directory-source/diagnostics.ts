/**
 * 编辑器诊断供给侧：枚举一次算出资源文件全集与译文键（并集/逐语言/逐文件三种口径），
 * 供 `analyzeStory` 与本地化工作台使用。
 *
 * `resourceFiles` = `paths()` **原样全集**（含清单/故事/语言目录属无害冗余，只令 `has()` 为真）。
 * **有意不做加密后缀特判**：编辑器是**明文工程形态**（加密故事在打开时已 fail-closed）
 * ⇒ 能打开的工程里运行期解析 = 明文名字直查（`createStaticResourcePort.resolve`，
 * 无加密探测），剥后缀反而制造「编辑器说在、运行期说缺」的分叉；加密工程编辑器打不开，
 * 剥不剥都无意义。**有意不读文件头判加密**：魔数知识归 Rust（安全边界在 Rust 层），
 * 且运行期逻辑路径定义与内容格式无关（明文文件名的加密内容运行期走格式错误，
 * 不当明文用）——读头既换不来对齐、还把格式知识引入 TS + 每文件多一次 I/O。
 *
 * `overlayKeys` = `Lang/**` 下全部 `.json`（目录形态 `Lang/{lang}/**` 与单文件
 * `Lang/{lang}.json` 两种写法都命中）的键**并集**。与 Rust 供给的差异说明：Rust 按 `lang`
 * 单语言供给，而「译文键在故事里找不到原文」与语言无关 ⇒ 编辑器取**跨语言并集**才能覆盖
 * 所有死键（编辑器暂无语言选择器；单语言口径在只有 `en/` 而无 `zh-CN/` 的工程上会整体失效）。
 * 加密 overlay（`.json.enc` 结尾）**走同一供给参与对账**：能解密的供给（如 Tauri 形态的
 * `text` 经 Rust 返回明文）正常入集；浏览器形态无密钥，密文 JSON 解析失败 →
 * `parseOverlayEntries` 宽容跳过——与「单文件内容坏」同语义，少报不误报。
 *
 * `overlayFilesByLang` = 逐语言逐文件的真实布局表（工作台反映 per-story 布局用）：
 * 坏文件跳过不进表；有效零键文件仍出现（空键集）；路径原样不归一（单文件形态就是
 * `Lang/{lang}.json`）。`layoutConflicts` 与编辑器 `findLayoutConflicts` 同口径：
 * 同一语言内同键 ≥2 文件且取值 ≥2 种（跨语言不比），全部语言合并一张列表
 * （语言码元序拼接、语言内键码元序、sites 按路径再按值码元序）。
 * `unmarkedHostTexts` 只有能读宿主源码的供给方（Node/CLI 形态）可填，这里不填。
 *
 * 失败语义：枚举/读取失败**原样抛出**（不静默降级空集合——半套数据会让诊断漏报）；
 * 单文件内容坏则宽容跳过（与 Rust 一致，见 `parseOverlayEntries`）。
 *
 * 编辑器**唯一**接线点 = 组合根调用 `loadDiagnosticSupply`。
 */
import type { DiagnosticSupply, ProjectFileSource } from "@lingfan-engine/core";
import { compareOrdinal, LANG_DIR } from "@lingfan-engine/core";

/** overlay 候选文件：`Lang/` 下、`.json` 或 `.json.enc` 结尾（点文件已由枚举口径剔除） */
function isOverlayPath(path: string): boolean {
  return (
    path.startsWith(`${LANG_DIR}/`) &&
    (path.endsWith(".json") || path.endsWith(".json.enc"))
  );
}

/** 从 overlay 逻辑路径取语言码（`Lang/en/main.json` → `en`；`Lang/en.json` → `en`） */
export function langOfOverlayPath(path: string): string | undefined {
  if (!isOverlayPath(path)) return undefined;
  const rest = path.slice(`${LANG_DIR}/`.length).replace(/\.json(\.enc)?$/, "");
  // 目录形态取首段、单文件形态整段就是语言码（`rest` 内不含 `/` 时即单文件）
  const head = rest.split("/")[0] ?? "";
  return head === "" ? undefined : head;
}

/**
 * overlay 译文表解析（Rust `load_overlay_files` 同语义）：**坏 JSON / 含非字符串值 →
 * 整个文件跳过**（宽松口径：少报不误报）。返回 `undefined` = 跳过。
 */
function parseOverlayEntries(text: string): Record<string, string> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") return undefined; // 非字符串值 = 整文件无效（不部分采用）
    entries[key] = raw;
  }
  return entries;
}

/** 布局冲突条目（`DiagnosticSupply.layoutConflicts` 的可变工作形态） */
interface ConflictDraft {
  key: string;
  sites: { path: string; value: string }[];
}

/**
 * 单语言内的布局冲突（编辑器 `findLayoutConflicts` 同口径）：
 * 同键 ≥2 文件且取值 ≥2 种；sites 按路径再按值码元序，键码元序。
 */
function conflictsOfLang(
  files: readonly { path: string; entries: Record<string, string> }[],
): ConflictDraft[] {
  const sitesByKey = new Map<string, { path: string; value: string }[]>();
  for (const file of files) {
    for (const [key, value] of Object.entries(file.entries)) {
      const sites = sitesByKey.get(key) ?? [];
      sites.push({ path: file.path, value });
      sitesByKey.set(key, sites);
    }
  }
  const conflicts: ConflictDraft[] = [];
  for (const key of [...sitesByKey.keys()].sort(compareOrdinal)) {
    const sites = sitesByKey.get(key) ?? [];
    if (sites.length < 2) continue;
    if (new Set(sites.map((site) => site.value)).size < 2) continue;
    sites.sort(
      (a, b) =>
        compareOrdinal(a.path, b.path) || compareOrdinal(a.value, b.value),
    );
    conflicts.push({ key, sites });
  }
  return conflicts;
}

/** 枚举一次算出资源文件全集、译文键（并集/逐语言）、逐文件布局表与布局冲突 */
export async function loadDiagnosticSupply(
  source: ProjectFileSource,
): Promise<DiagnosticSupply> {
  const paths = await source.paths();
  const resourceFiles = new Set<string>();
  const overlayKeys = new Set<string>();
  const overlayKeysByLang = new Map<string, Set<string>>();
  // 逐语言有效文件表（含零键文件）：overlayFilesByLang 与 layoutConflicts 的共同底稿
  const filesByLang = new Map<
    string,
    { path: string; entries: Record<string, string> }[]
  >();
  for (const path of paths) {
    resourceFiles.add(path);
    if (!isOverlayPath(path)) continue;
    const entries = parseOverlayEntries(await source.text(path));
    if (entries === undefined) continue;
    const lang = langOfOverlayPath(path);
    if (lang !== undefined) {
      const files = filesByLang.get(lang) ?? [];
      files.push({ path, entries });
      filesByLang.set(lang, files);
    }
    for (const key of Object.keys(entries)) {
      overlayKeys.add(key);
      // 语言码取不出（理论上不该发生：isOverlayPath 已限定形态）⇒ 键进并集但不进分组，
      // 宁可工作台少显示一个语言，也不把键算到错误语言名下。
      if (lang === undefined) continue;
      const bucket = overlayKeysByLang.get(lang) ?? new Set<string>();
      bucket.add(key);
      overlayKeysByLang.set(lang, bucket);
    }
  }
  const overlayFilesByLang = new Map<string, Map<string, Set<string>>>();
  const layoutConflicts: ConflictDraft[] = [];
  for (const lang of [...filesByLang.keys()].sort(compareOrdinal)) {
    const files = filesByLang.get(lang) ?? [];
    const byPath = new Map<string, Set<string>>();
    for (const file of files) {
      byPath.set(file.path, new Set(Object.keys(file.entries)));
    }
    overlayFilesByLang.set(lang, byPath);
    layoutConflicts.push(...conflictsOfLang(files));
  }
  return {
    resourceFiles,
    overlayKeys,
    overlayKeysByLang,
    overlayFilesByLang,
    layoutConflicts,
  };
}
