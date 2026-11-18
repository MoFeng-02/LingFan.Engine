/**
 * 语言清单注册表：扫描资源根下的 `Lang/` 目录，得出语言码与每语言的 overlay 文件表。
 *
 * 清单是**磁盘事实的投影**（与故事清单同一条理由）：作者放一个语言目录/单文件进去，
 * 构建期就该看见它，不该手抄名单。运行期 Web 供给（adapters `createFetchI18nPort` /
 * `createHttpI18nPort`）按这份清单取件，不再扫目录。
 *
 * 布局判据与 Rust `load_overlay_files` 同口径：
 * - 目录形态 `Lang/{lang}/` 存在 ⇒ 递归收集 `.json` / `.json.enc`（点文件跳过）；
 * - 否则单文件形态 `Lang/{lang}.json`；同名目录与单文件并存时目录优先（Rust 同序）；
 * - `Lang/` 不存在 ⇒ 空清单（无多语言供给是合法工程形态）。
 *
 * 目录名取 `@lingfan-engine/core` 的一处声明（`LANG_DIR`）；排序 = 语言码与文件路径
 * 均码元序（`compareOrdinal`），不随目录读取顺序漂移。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareOrdinal, LANG_DIR } from "@lingfan-engine/core";

/** overlay 文件扩展名：明文 `.json` 与加密 `.json.enc` 都是供给候选 */
export const LANG_EXTENSIONS = [".json", ".json.enc"] as const;

/** 语言清单条目：语言码 + 该语言的 overlay 文件逻辑路径表（相对资源根，码元序） */
export interface LangRegistryEntry {
  /** 语言码（目录名或单文件名去扩展名） */
  lang: string;
  /** overlay 文件逻辑路径（`Lang/{lang}/**` 或 `Lang/{lang}.json`，码元序） */
  files: readonly string[];
}

/** 文件是否命中 overlay 扩展名（大小写不敏感；`.json.enc` 先于 `.json` 判定） */
function isOverlayFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (LANG_EXTENSIONS as readonly string[]).some((ext) =>
    lower.endsWith(ext),
  );
}

/**
 * 扫描 `Lang/` 目录，返回语言清单（语言码码元序；每语言文件表码元序）。
 *
 * @param langDir `Lang/` 目录的绝对路径（资源根下的 `<LANG_DIR>`）
 */
export function scanLangRegistry(
  langDir: string,
): readonly LangRegistryEntry[] {
  const out: LangRegistryEntry[] = [];
  if (!existsSync(langDir)) return out;
  const walk = (dir: string, prefix: string, files: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel, files);
        continue;
      }
      if (isOverlayFile(entry.name)) files.push(rel);
    }
  };
  for (const entry of readdirSync(langDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const files: string[] = [];
      walk(join(langDir, entry.name), `${LANG_DIR}/${entry.name}`, files);
      out.push({ lang: entry.name, files: files.sort(compareOrdinal) });
      continue;
    }
    // 单文件形态只认 `.json`（Rust 降级路径就是 `Lang/{lang}.json`，无 `.enc` 单文件）
    if (!entry.name.toLowerCase().endsWith(".json")) continue;
    const lang = entry.name.slice(0, -".json".length);
    if (lang === "") continue;
    // 同名目录优先（Rust 先查目录再降级单文件；目录可能在 readdir 序里靠后，按磁盘判）
    if (existsSync(join(langDir, lang))) continue;
    out.push({ lang, files: [`${LANG_DIR}/${entry.name}`] });
  }
  return out.sort((a, b) => compareOrdinal(a.lang, b.lang));
}
