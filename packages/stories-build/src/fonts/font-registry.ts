/**
 * 字体名注册表：递归扫描 Resources/Fonts 下的字体文件，以「文件名去扩展名」为合法字体名。
 *
 * 字体名只在 stories-build 构建链内流转（构建期检查 + 宿主 @font-face 注入），不含运行时状态，
 * 因此引擎侧不设端口。目录缺失 = 空注册表（未引用字体名的工程零打扰；引用了即 fail-closed）。
 *
 * 字体按分类分目录存放（如 OTF/、TTF/、WOFF2/）是本注册表支持的常规形态：子目录逐层下探，
 * 同族字体的不同格式（`.otf` 与 `.ttf`）因此可同名共存——宿主为同族各注一条 @font-face，
 * 浏览器按自身支持的格式择优。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareOrdinal } from "@lingfan-engine/core";

/** 字体根目录名（位于 Resources/ 之下） */
export const FONTS_DIR_NAME = "Fonts";

/** 参与注册表的字体扩展名（小写比较）；注册表只发文件名，宿主按扩展名选 format() */
export const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

export interface FontEntry {
  /** 相对字体根的路径（含子目录，`/` 分隔），供宿主拼 `/Fonts/<file>` 资源 URL */
  readonly file: string;
  /** 字体名 = 文件名去扩展名，故事层只引用这个名字 */
  readonly name: string;
}

/**
 * 递归扫描字体根产注册表；目录不存在或为空 = 空数组（合法，等价「未声明任何字体」）。
 * `file` 按码元序稳定排序，保证注册表（与后续产物）不受文件系统枚举顺序影响。
 */
export function scanFontRegistry(fontsDir: string): readonly FontEntry[] {
  if (!existsSync(fontsDir)) {
    return [];
  }
  const entries: FontEntry[] = [];
  collectFonts(fontsDir, "", entries);
  entries.sort((a, b) => compareOrdinal(a.file, b.file));
  return entries;
}

/**
 * 递归收集字体文件：`prefix` 为当前条目相对字体根的路径前缀（`/` 分隔），子目录逐层下探。
 * 点文件与点目录（.DS_Store、.hidden 字体族）整族跳过——不是作者意图内的字体。
 */
function collectFonts(dir: string, prefix: string, entries: FontEntry[]): void {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) {
      continue;
    }
    const file = prefix === "" ? item.name : `${prefix}/${item.name}`;
    if (item.isDirectory()) {
      collectFonts(join(dir, item.name), file, entries);
      continue;
    }
    if (!item.isFile()) {
      continue;
    }
    const dot = item.name.lastIndexOf(".");
    if (dot <= 0) {
      continue;
    }
    const ext = item.name.slice(dot).toLowerCase();
    if (!(FONT_EXTENSIONS as readonly string[]).includes(ext)) {
      continue;
    }
    entries.push({ file, name: item.name.slice(0, dot) });
  }
}

/** 字体名集合视图（供编译器 fail-closed 检查使用） */
export function fontNameSet(
  entries: readonly FontEntry[],
): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.name));
}
