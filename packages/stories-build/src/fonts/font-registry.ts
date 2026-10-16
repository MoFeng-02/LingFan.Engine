/**
 * 字体名注册表：扫描 Resources/Fonts 下的字体文件，以「文件名去扩展名」为合法字体名。
 *
 * 字体名只在 stories-build 构建链内流转（构建期检查 + 宿主 @font-face 注入），不含运行时状态，
 * 因此引擎侧不设端口。目录缺失 = 空注册表（未引用字体名的工程零打扰；引用了即 fail-closed）。
 */
import { existsSync, readdirSync } from "node:fs";

/** 字体根目录名（位于 Resources/ 之下） */
export const FONTS_DIR_NAME = "Fonts";

/** 参与注册表的字体扩展名（小写比较）；注册表只发文件名，宿主按扩展名选 format() */
export const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

export interface FontEntry {
  /** 文件名（含扩展名），供宿主拼 URL */
  readonly file: string;
  /** 字体名 = 文件名去扩展名，故事层只引用这个名字 */
  readonly name: string;
}

/**
 * 扫描字体根目录产注册表；目录不存在或为空 = 空数组（合法，等价「未声明任何字体」）。
 * 文件名按字典序稳定排序，保证注册表（与后续产物）不受文件系统枚举顺序影响。
 */
export function scanFontRegistry(fontsDir: string): readonly FontEntry[] {
  if (!existsSync(fontsDir)) {
    return [];
  }
  const entries: FontEntry[] = [];
  for (const file of readdirSync(fontsDir)) {
    const dot = file.lastIndexOf(".");
    // 点文件（.DS_Store、.hidden.ttf）整族跳过：后者虽有扩展名，但「.hidden」不是作者意图内的字体名
    if (dot <= 0 || file.startsWith(".")) {
      continue;
    }
    const ext = file.slice(dot).toLowerCase();
    if (!(FONT_EXTENSIONS as readonly string[]).includes(ext)) {
      continue;
    }
    entries.push({ file, name: file.slice(0, dot) });
  }
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return entries;
}

/** 字体名集合视图（供编译器 fail-closed 检查使用） */
export function fontNameSet(
  entries: readonly FontEntry[],
): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.name));
}
