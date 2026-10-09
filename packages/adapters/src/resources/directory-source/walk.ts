/**
 * 目录句柄遍历：路径工具、句柄缺失判定与递归枚举。
 * 枚举口径照 Rust `collect_story_files`：`Stories/**` 递归、跳过点文件名、不设扩展名白名单。
 */

/** 点文件/点目录（任何一层）：资源根里 `.*` 一律不是工程内容（与运行期枚举同口径，目录一并跳） */
export function isDotName(name: string): boolean {
  return name.startsWith(".");
}

/** 路径的段数（按 `/` 数）：`"a/b/c"` → 3，`""` → 1 —— 用于判断「在资源根下几层」 */
export function segmentDepth(path: string): number {
  return path.split("/").length;
}

/** 取父目录前缀（**带尾斜杠**）：`"a/b/c"` → `"a/b/"`；无斜杠（顶层）→ 空串 */
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

/**
 * 尝试取直接子文件：**缺了就是 `undefined`**（探测语义，不是错误）。
 * 权限之类的真异常照旧抛出——把它们也当成「没有」会让权限问题变成内容问题。
 */
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

/**
 * 尝试取直接子目录：与 `tryFileHandle` 同一形态——缺了算 `undefined`，
 * 真异常（权限等）继续往上抛。
 */
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

/**
 * 递归收集 `dir` 下的全部文件，把相对路径追加进 `into`（原地写入，不返回新数组）。
 *
 * 路径以 `/` 连接、不含 `dir` 自身的名字；点文件与点目录整棵跳过。
 * 结果顺序即目录枚举顺序，**未排序**——需要稳定顺序的调用方自己排。
 */
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
