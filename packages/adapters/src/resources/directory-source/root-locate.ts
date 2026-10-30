/**
 * 资源根定位（两套取径共用）：
 * - 句柄形态在同层目录与 `Resources/` 之间找清单，缺清单但含 `Stories/` 时降级认作合法资源根；
 * - 路径形态（目录 input 快照）以清单所在层为资源根，同深多个清单即无法判定。
 * 资源根 = 逻辑路径的相对基准，与 fetch / Tauri 两种供给实现的键完全一致。
 */
import {
  compareOrdinal,
  MANIFEST_FILE,
  RESOURCES_DIR,
  STORIES_DIR,
} from "@lingfan-engine/core";
import { defaultResourceTexts, type ResourceTexts } from "../texts";
import { dirOf, segmentDepth, tryDirectoryHandle, tryFileHandle } from "./walk";

/** 工程惯例的资源根子目录名：权威声明在引擎契约（此处只转发，包内消费方沿用旧路径） */
export { RESOURCES_DIR } from "@lingfan-engine/core";

/**
 * 资源根定位（FSA）：所选目录含清单即资源根；否则下探一层 `Resources/`
 * （工程惯例里资源根就在该子目录）。都无清单但有 `Stories/` ⇒ **缺清单的合法资源根**
 * （读取时会合成最小清单并显式回执）。都没有 → fail-closed 报可操作的话。
 */
export async function locateResourceRootHandle(
  picked: FileSystemDirectoryHandle,
  texts?: Partial<ResourceTexts>,
): Promise<{ root: FileSystemDirectoryHandle; name: string }> {
  const t = { ...defaultResourceTexts, ...texts };
  if ((await tryFileHandle(picked, MANIFEST_FILE)) !== undefined) {
    return { root: picked, name: picked.name };
  }
  const resources = await tryDirectoryHandle(picked, RESOURCES_DIR);
  if (
    resources !== undefined &&
    (await tryFileHandle(resources, MANIFEST_FILE)) !== undefined
  ) {
    return { root: resources, name: resources.name };
  }
  // 降级候选：无清单但有 Stories/（缺清单只是缺 formatVersion/id/entry，合成即可）
  if ((await tryDirectoryHandle(picked, STORIES_DIR)) !== undefined) {
    return { root: picked, name: picked.name };
  }
  if (
    resources !== undefined &&
    (await tryDirectoryHandle(resources, STORIES_DIR)) !== undefined
  ) {
    return { root: resources, name: resources.name };
  }
  throw new Error(t.rootLocateHandleMissing(picked.name));
}

/**
 * 资源根定位（文件快照）：清单所在层即资源根（清单必须在资源根内的推论）。
 * 同深出现多个清单 = 无法判定 → fail-closed 让用户直接选资源根，不替用户猜。
 * 降级：无清单时以 `Stories/` 目录定位资源根（读取时会合成清单并显式回执）；
 * 连 Stories/ 都没有才 fail-closed。
 */
export function locateResourceRootFromPaths(
  paths: readonly string[],
  texts?: Partial<ResourceTexts>,
): {
  /** 资源根前缀（`""` 或 `Resources/`） */
  root: string;
  /** 清单逻辑路径（资源根相对；**缺清单时是期望位置**，存在与否由读取侧判定） */
  manifest: string;
} {
  const t = { ...defaultResourceTexts, ...texts };
  const candidates = paths.filter(
    (path) => path === MANIFEST_FILE || path.endsWith(`/${MANIFEST_FILE}`),
  );
  if (candidates.length > 0) {
    const sorted = [...candidates].sort((a, b) => {
      const depth = segmentDepth(a) - segmentDepth(b);
      return depth !== 0 ? depth : compareOrdinal(a, b);
    });
    const first = sorted[0] ?? MANIFEST_FILE;
    const ambiguous = sorted.filter(
      (path) =>
        segmentDepth(path) === segmentDepth(first) &&
        dirOf(path) !== dirOf(first),
    );
    if (ambiguous.length > 0) {
      throw new Error(t.rootLocateMultipleManifests(first, ambiguous[0] ?? ""));
    }
    return { root: dirOf(first), manifest: MANIFEST_FILE };
  }
  // 降级：无清单 ⇒ 以 Stories/ 目录定位资源根（同层多个 = 无法判定，fail-closed）
  const storyRoots = new Set<string>();
  for (const path of paths) {
    if (path.startsWith(`${STORIES_DIR}/`)) storyRoots.add("");
    else {
      const marker = `/${STORIES_DIR}/`;
      const idx = path.indexOf(marker);
      if (idx >= 0) storyRoots.add(path.slice(0, idx + 1));
    }
  }
  if (storyRoots.size === 0) {
    throw new Error(t.rootLocatePathsMissing());
  }
  if (storyRoots.size > 1) {
    throw new Error(
      t.rootLocateMultipleStoryRoots(
        [...storyRoots].map((r) => `${r || "根层"}${STORIES_DIR}`).join("、"),
      ),
    );
  }
  return { root: [...storyRoots][0] ?? "", manifest: MANIFEST_FILE };
}
