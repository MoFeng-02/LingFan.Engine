/**
 * 文件戳采集：逻辑路径 → lastModified/size。
 * 缺失/不可读的路径**不入表**——读取侧取不到即认定为「被外部删除」，
 * 于是冲突判定能把「消失」与「改动」区分开；IO 以外的致命问题照抛。
 */
import type { FileStamp } from "@lingfan/engine";
import { isMissingHandle } from "../walk";
import { asWritableDir, safeSegments } from "./access";

export async function collectFileStamps(
  root: FileSystemDirectoryHandle,
  paths: readonly string[],
): Promise<Map<string, FileStamp>> {
  const stamps = new Map<string, FileStamp>();
  for (const path of paths) {
    try {
      let dir: FileSystemDirectoryHandle = root;
      const segments = safeSegments(path);
      for (const segment of segments.slice(0, -1)) {
        dir = await asWritableDir(dir).getDirectoryHandle(segment);
      }
      const handle = await asWritableDir(dir).getFileHandle(
        segments[segments.length - 1] ?? "",
      );
      const file = await handle.getFile();
      stamps.set(path, {
        lastModified: file.lastModified,
        size: file.size,
      });
    } catch (error: unknown) {
      if (isMissingHandle(error)) continue; // 缺失 = 留空（比对时判冲突）
      throw error;
    }
  }
  return stamps;
}
