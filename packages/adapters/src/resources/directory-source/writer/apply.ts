/**
 * 工程写入编排（FSA 真目录）：与**打开基线**求最小差量 → 先写后删。
 *
 * 顺序固定：申请写权限 → **冲突检测** → 建 `Stories/` → 写列文件 → 写 `project.json` → 删陈旧文件。
 * 永不先删后写：任一步失败时磁盘上最坏只是「多出文件」，工程仍可加载；失败不更新基线，
 * 重试即幂等收敛。
 *
 * **并发检测**：构造时对基线文件集采集指纹（`getFile()` → lastModified/size），
 * 每次 `apply` 在落盘前重新采集比对——外部改动/删除 → 抛可操作冲突错误（零写入）；
 * 写回成功后快照整体换新（自己的保存永不自报）。读指纹只需 read 权限（打开时已获）。
 */
import {
  conflictMessage,
  detectWriteConflicts,
  diffProjectFiles,
  MANIFEST_FILE,
  STORIES_DIR,
  type ProjectWriteReport,
  type ProjectWriterPort,
} from "@lingfan/engine";
import { locateResourceRootHandle } from "../root-locate";
import { asWritableDir, ensureWriteAccess, normalizeWriteError } from "./access";
import { removeFileAt, writeFileAt } from "./entry";
import { collectFileStamps } from "./stamps";

export async function createHandleProjectWriter(
  picked: FileSystemDirectoryHandle,
  previous: ReadonlyMap<string, string>,
): Promise<ProjectWriterPort> {
  const { root } = await locateResourceRootHandle(picked);
  let baseline = new Map(previous);
  let stamps = await collectFileStamps(root, [...baseline.keys()]);
  return {
    writable: true,
    async apply(files: ReadonlyMap<string, string>): Promise<ProjectWriteReport> {
      const { changes, deletes } = diffProjectFiles(files, baseline);
      const written: string[] = [];
      const deleted: string[] = [];
      try {
        await ensureWriteAccess(root); // 手势窗口：保持为第一个 await
        // 冲突检测：任何落盘之前重采指纹比对（读只需 read 权限，不弹权限）
        const current = await collectFileStamps(root, [...stamps.keys()]);
        const conflicts = detectWriteConflicts(stamps, current);
        if (conflicts.length > 0) {
          throw new Error(conflictMessage(conflicts));
        }
        // `Stories/` 可能不存在（首次写回 / 用户清空）→ 建之
        await asWritableDir(root).getDirectoryHandle(STORIES_DIR, {
          create: true,
        });
        // 列文件先写，`project.json` 最后写（= 提交点：入口列改名在删除前已指向新 id）
        const columnPaths = [...changes.keys()].filter(
          (path) => path !== MANIFEST_FILE,
        );
        const manifestText = changes.get(MANIFEST_FILE);
        const ordered =
          manifestText === undefined
            ? columnPaths
            : [...columnPaths, MANIFEST_FILE];
        for (const path of ordered) {
          await writeFileAt(root, path, changes.get(path) ?? "");
          written.push(path);
        }
        for (const path of deletes) {
          await removeFileAt(root, path);
          deleted.push(path);
        }
      } catch (error: unknown) {
        throw normalizeWriteError(error);
      }
      baseline = new Map(files); // 成功才更新基线 → 二次保存不重复写
      stamps = await collectFileStamps(root, [...baseline.keys()]); // 快照换新：自己的保存不自报
      return { written, deleted };
    },
  };
}
