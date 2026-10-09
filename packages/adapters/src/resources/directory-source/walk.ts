/**
 * 目录句柄遍历：路径工具、句柄缺失判定与递归枚举。
 * 枚举口径照 Rust `collect_story_files`：`Stories/**` 递归、跳过点文件名、不设扩展名白名单。
 */

/** 点文件/点目录（任何一层）：资源根里 `.*` 一律不是工程内容（与运行期枚举同口径，目录一并跳） */
export function isDotName(name: string): boolean {
  return name.startsWith(".");
}

export function segmentDepth(path: string): number {
  return path.split("/").length;
}

export function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at + 1);
}

/** 句柄缺失（未找到/类型不符）判定：其余异常（权限等）不吞 */
export function isMissingHandle(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

export async function tryFileHandle(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | undefined> {
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if (isMissingHandle(error)) return undefined;
    throw error;
  }
}

export async function tryDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await dir.getDirectoryHandle(name);
  } catch (error) {
    if (isMissingHandle(error)) return undefined;
    throw error;
  }
}

export async function walkHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  into: string[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (isDotName(entry.name)) continue;
    if (entry.kind === "file") {
      into.push(`${prefix}${entry.name}`);
      continue;
    }
    await walkHandle(entry, `${prefix}${entry.name}/`, into);
  }
}
