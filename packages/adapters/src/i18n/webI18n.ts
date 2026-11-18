/**
 * I18N overlay 供给（Web/HTTP 形态）：静态资源根按路径前缀直取 `Lang/**` 文件
 * （`Lang/` 是静态资源目录的一部分，浏览器/桌面 WebView/小程序 H5 同一取件面）。
 *
 * 两种取件面（与 `createFetchProjectFilesPort` / `createHttpProjectFilesPort` 同构）：
 * - `createFetchI18nPort`：全局 `fetch` + 路径前缀 `root`（缺省 `"/"`）；
 * - `createHttpI18nPort`：可注入 `HttpFetch`（缺省包全局 `fetch`），测试以契约替身注入。
 *
 * 语言清单来自**构建期** Lang 清单（stories-build `virtual:lang-list` 扫描
 * `Resources/Lang` 的产物），运行期不再扫目录：清单给出语言码与每语言的 overlay
 * 文件路径表（相对资源根的逻辑路径，码元序）。目录形态 `Lang/{lang}/**` 与单文件
 * `Lang/{lang}.json` 两种写法都由清单表达，本侧只按表取件。
 *
 * 语义与 Tauri/Rust 侧（`load_i18n_overlay`）对齐：
 * - 语言段非法（字母数字/_/- 之外或超长）⇒ 抛错（fail-closed）；
 * - HTTP 失败 ⇒ 抛错，不静默降级；
 * - 单文件内容坏（坏 JSON / 根非对象 / 含非字符串值）⇒ **整文件跳过**（少报不误报）；
 *   加密 `.json.enc` 浏览器侧解不开 ⇒ 解析失败走同一宽容跳过；
 * - 清单无该语言、或全部文件都无效 ⇒ 抛「供给为空」（与 Rust 同文案）；
 * - overlay 内相对路径 = 剥 `Lang/{lang}/` 前缀；单文件形态 ⇒ `"main.json"`；
 * - 输出按相对路径码元序（确定性供给序）；**合并序归引擎**（main.json 兜底最先）。
 *
 * `listLanguages`：默认语言 `zh-CN` 恒含居首（契约要求），其余按码元序去重。
 */
import type { I18nOverlayFile, I18nPort } from "@lingfan-engine/core";
import { compareOrdinal, DEFAULT_LANG, LANG_DIR } from "@lingfan-engine/core";
import type { HttpFetch, HttpTextResponse } from "../resources";

/** 构建期 Lang 清单条目：语言码 + 该语言的 overlay 文件路径表（相对资源根，码元序） */
export interface I18nLangEntry {
  lang: string;
  files: readonly string[];
}

/** 浏览器 fetch 形态的入参：构建期语言清单 + 静态根路径前缀（缺省 `"/"`） */
export interface FetchI18nOptions {
  /** 构建期 Lang 清单（`virtual:lang-list` 产物） */
  langs: readonly I18nLangEntry[];
  /** 静态资源根前缀（如 `"/"` 或 `"/app/"`；文件 URL = `${root}${path}`） */
  root?: string;
}

/** 可注入取件面形态的入参：清单 + 前缀 + `HttpFetch`（缺省包全局 `fetch`） */
export interface HttpI18nOptions extends FetchI18nOptions {
  fetch?: HttpFetch;
}

/** 语言段判据（Rust `valid_lang` 同口径：字母数字/_/-，1..32） */
const LANG_SEGMENT = /^[A-Za-z0-9_-]{1,32}$/;

/** 全局 `fetch` 包成取件面（浏览器 / WebView / H5） */
function defaultHttpFetch(): HttpFetch {
  return async (url: string): Promise<HttpTextResponse> => fetch(url);
}

/**
 * overlay 译文表解析（Rust `load_overlay_files` 同语义）：坏 JSON / 根非对象 /
 * 含非字符串值 ⇒ 整文件跳过。返回 `undefined` = 跳过。
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
    if (typeof raw !== "string") return undefined; // 非字符串值 = 整文件无效
    entries[key] = raw;
  }
  return entries;
}

/** overlay 逻辑路径 → 供给面相对路径（剥 `Lang/{lang}/` 前缀；单文件 ⇒ `main.json`） */
function overlayPathOf(path: string, lang: string): string {
  const prefix = `${LANG_DIR}/${lang}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : "main.json";
}

/** 共享实现：两种取件面只差 `HttpFetch` 的来源 */
function createI18nPort(options: FetchI18nOptions, read: HttpFetch): I18nPort {
  const root = options.root ?? "/";
  const byLang = new Map<string, readonly string[]>();
  for (const entry of options.langs) {
    // 同语言多条清单条目时合并（清单本应无重复；合并不丢供给）
    const prior = byLang.get(entry.lang) ?? [];
    byLang.set(entry.lang, [...prior, ...entry.files]);
  }
  return {
    async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
      if (!LANG_SEGMENT.test(lang)) {
        throw new Error(`非法语言段：${lang}`);
      }
      const paths = byLang.get(lang) ?? [];
      const files: I18nOverlayFile[] = [];
      for (const path of [...paths].sort(compareOrdinal)) {
        const response = await read(`${root}${path}`);
        if (!response.ok) {
          throw new Error(`${path} 加载失败：HTTP ${response.status}`);
        }
        const entries = parseOverlayEntries(await response.text());
        if (entries === undefined) continue; // 单文件内容坏 ⇒ 整文件跳过（少报不误报）
        files.push({ path: overlayPathOf(path, lang), entries });
      }
      if (files.length === 0) {
        throw new Error(
          `I18N 译文供给为空：${LANG_DIR}/${lang}/ 目录与 ${LANG_DIR}/${lang}.json 单文件均无有效译文`,
        );
      }
      files.sort((a, b) => compareOrdinal(a.path, b.path));
      return files;
    },
    async listLanguages(): Promise<string[]> {
      const rest = [...byLang.keys()]
        .filter((lang) => lang !== DEFAULT_LANG)
        .sort(compareOrdinal);
      return [DEFAULT_LANG, ...rest];
    },
  };
}

/**
 * 造一个多语言端口（浏览器 fetch 形态）：静态根前缀直取清单给出的 overlay 文件。
 * 失败抛错不静默降级；合并序归引擎。
 */
export function createFetchI18nPort(options: FetchI18nOptions): I18nPort {
  return createI18nPort(options, defaultHttpFetch());
}

/**
 * 造一个多语言端口（可注入 `HttpFetch` 形态）：取件面可注入契约替身
 * （测试不依赖网络；桌面 WebView / 小程序桥接亦可注入自己的实现）。
 */
export function createHttpI18nPort(options: HttpI18nOptions): I18nPort {
  return createI18nPort(options, options.fetch ?? defaultHttpFetch());
}
