/**
 * 场景注册表：扫描源根兄弟目录 `scenes/<名>/` 下的实现文件，以**目录名**为合法场景名。
 *
 * 与 UI 注册表同构，但两张表刻意互不相干：UI 是「挂在列上的叠加层」，场景是
 * 「列自己的身体」。合并成一张表会让 `mount("map")` 能挂到一个身体组件上、
 * `body: { name: "hub" }` 能指到一个 HUD——「换列不换挂载」的分离就没了。
 *
 * 目录缺失 = 空注册表（不做组件化的工程零打扰；引用了即 fail-closed）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareOrdinal } from "@lingfan-engine/core";
import {
  SCENE_DIR_NAME,
  UI_EXTENSIONS,
  type SceneRegistryEntry,
} from "../compiler/story-compiler/graph/core.ts";

// 目录名与条目形状的权威声明在图谱层 `core.ts`：场景通道（导入期）与注册表
//（扫描期）消费的是同一份事实，两边各写一份就会各自演化。这里只做转发。
export { SCENE_DIR_NAME };

export type SceneFileEntry = SceneRegistryEntry;

/**
 * 扫描场景根目录产注册表；目录不存在或为空 = 空数组（合法，等价「本工程没有组件化列」）。
 *
 * 收录条件 = 目录下存在 `<目录名>.<组件扩展名>` 的文件（名字与文件名必须一致，
 * 这条规则同时决定导入的绑定名与文件位置）。只认一层目录：`scenes/<名>/<名>.<ext>`
 * 之外的布局在导入期已被判越界，这里不重复放宽。
 *
 * 名字按码元序稳定排序，保证注册表（与后续诊断、生成物文本）不受文件系统枚举顺序影响。
 */
export function scanSceneRegistry(
  scenesRoot: string,
): readonly SceneFileEntry[] {
  if (!existsSync(scenesRoot)) {
    return [];
  }
  const entries: SceneFileEntry[] = [];
  for (const name of readdirSync(scenesRoot)) {
    if (name.startsWith(".")) {
      continue;
    }
    const dir = join(scenesRoot, name);
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      // 不是目录（`scenes/README.md` 这类散文件）：不构成一个场景，跳过。
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

/** 场景名集合视图（供构建期 fail-closed 检查使用） */
export function sceneNameSet(
  entries: readonly SceneFileEntry[],
): ReadonlySet<string> {
  return new Set(entries.map((entry) => entry.name));
}
