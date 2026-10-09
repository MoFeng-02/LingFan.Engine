/**
 * 单文件写入与删除：中间目录缺失则创建；写失败 abort 不落半截；
 * 删除时「找不到」视作已删（幂等），其余异常照抛。
 */
import { isMissingHandle } from "../walk";
import { asWritableDir, asWritableFile, safeSegments } from "./access";

/** 写入单个文件（中间目录缺则创建；失败 abort 不落半截） */
export async function writeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  const segments = safeSegments(path);
  let dir = asWritableDir(root);
  for (const segment of segments.slice(0, -1)) {
    dir = asWritableDir(await dir.getDirectoryHandle(segment, { create: true }));
  }
  const file = await dir.getFileHandle(segments[segments.length - 1] ?? "", {
    create: true,
  });
  const writable = await asWritableFile(file).createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error: unknown) {
    await writable.abort();
    throw error;
  }
}

/** 删除单个文件（缺失 = 已删，幂等；目录缺失同样吞掉） */
export async function removeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const segments = safeSegments(path);
  let dir = asWritableDir(root);
  for (const segment of segments.slice(0, -1)) {
    let next: FileSystemDirectoryHandle;
    try {
      next = await dir.getDirectoryHandle(segment);
    } catch (error: unknown) {
      if (isMissingHandle(error)) return;
      throw error;
    }
    dir = asWritableDir(next);
  }
  try {
    await dir.removeEntry(segments[segments.length - 1] ?? "");
  } catch (error: unknown) {
    if (isMissingHandle(error)) return;
    throw error;
  }
}
