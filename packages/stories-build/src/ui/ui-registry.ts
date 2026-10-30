/**
 * UI 名注册表：扫描源根兄弟目录 `ui/<名>/` 下的实现文件，以**目录名**为合法 UI 名。
 *
 * 与字体注册表同构（`fonts/font-registry.ts`）：UI 名只在构建链内流转，不含运行时状态，
 * 因此引擎侧不设端口。目录缺失 = 空注册表（未引用 UI 的工程零打扰；引用了即 fail-closed）。
 *
 * 为什么要有这张表：列级 `uis` 里的名字是**静态声明**，写错一个字母编译期毫无反应，
 * 要等宿主预加载落空、界面在挂载瞬间才闪出来。构建期对着目录核一遍，把这类笔误
 * 变成一次构建失败。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareOrdinal } from "@lingfan-engine/core";
import { UI_EXTENSIONS } from "../compiler/story-compiler/graph/core.ts";

/** UI 根目录名（源根的兄弟目录，与故事源平级） */
export const UI_DIR_NAME = "ui";

export interface UiFileEntry {
  /** UI 名（= 目录名 = 文件名去扩展名） */
  readonly name: string;
  /** 实现文件名（含扩展名），供诊断定位 */
  readonly file: string;
}

/**
 * 扫描 UI 根目录产注册表；目录不存在或为空 = 空数组（合法，等价「本工程没有 UI」）。
 *
 * 收录条件 = 目录下存在 `<目录名>.<UI 扩展名>` 的文件（名字与文件名必须一致，
 * 这条规则同时决定导入的绑定名与文件位置）。只认一层目录：`ui/<名>/<名>.<ext>` 之外
 * 的布局在导入期已被判越界，这里不重复放宽。
 *
 * 名字按码元序稳定排序，保证注册表（与后续诊断顺序）不受文件系统枚举顺序影响。
 */
export function scanUiRegistry(uiRoot: string): readonly UiFileEntry[] {
  if (!existsSync(uiRoot)) {
    return [];
  }
  const entries: UiFileEntry[] = [];
  for (const name of readdirSync(uiRoot)) {
    if (name.startsWith(".")) {
      continue;
    }
    const dir = join(uiRoot, name);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      // 不是目录（`ui/README.md` 这类散文件）：不构成一个 UI，跳过。
      continue;
    }
    for (const file of files) {
      const dot = file.lastIndexOf(".");
      if (dot <= 0) continue;
      const ext = file.slice(dot).toLowerCase();
      if (!(UI_EXTENSIONS as readonly string[]).includes(ext)) continue;
      if (file.slice(0, dot) !== name) continue;
      entries.push({ name, file });
      break;
    }
  }
  entries.sort((a, b) => compareOrdinal(a.name, b.name));
  return entries;
}

/** UI 名集合视图（供构建期 fail-closed 检查使用） */
export function uiNameSet(
  entries: readonly UiFileEntry[],
): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.name));
}
