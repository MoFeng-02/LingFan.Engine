/**
 * 文件源（两类取径）：
 * - 句柄源：File System Access 目录句柄，只枚举**资源根之内**（不扫所选目录的整棵子树，
 *   避免误选上层目录时白扫一堆无关文件）；
 * - 文件列表源：目录 input 的只读快照，路径剥掉资源根前缀，按逻辑路径查表。
 * 逻辑路径一律相对资源根（含 `project.json` 的那一层），与 fetch / Tauri 两种供给
 * 实现的键完全一致：组装器是唯一解析点，本模块只负责「取」。
 */
import type { ProjectFileSource } from "@lingfan/engine";
import { normalizeResourceId } from "../resourcePort";
import { locateResourceRootHandle, locateResourceRootFromPaths } from "./root-locate";
import { isDotName, tryDirectoryHandle, tryFileHandle, walkHandle } from "./walk";

/**
 * 目录句柄取径（Chromium FSA）：路径列表按需装载一次并 memo，
 * 之后每次 `paths()`/`text()`/`file()` 都复用同一份枚举结果。
 */
export async function createHandleFileSource(
  picked: FileSystemDirectoryHandle,
): Promise<ProjectFileSource> {
  const { root, name } = await locateResourceRootHandle(picked);
  let listing: Promise<readonly string[]> | null = null;
  const list = (): Promise<readonly string[]> => {
    listing ??= (async () => {
      const out: string[] = [];
      await walkHandle(root, "", out);
      return out.sort(); // 路径码元序确定（组装器前的确定性要求）
    })();
    return listing;
  };
  const resolveHandle = async (
    path: string,
  ): Promise<FileSystemFileHandle> => {
    const segments = normalizeResourceId(path).split("/");
    let dir: FileSystemDirectoryHandle = root;
    for (const segment of segments.slice(0, -1)) {
      const next = await tryDirectoryHandle(dir, segment);
      if (next === undefined) throw new Error(`资源不存在：${path}`);
      dir = next;
    }
    const file = await tryFileHandle(dir, segments[segments.length - 1] ?? "");
    if (file === undefined) throw new Error(`资源不存在：${path}`);
    return file;
  };
  return {
    name,
    paths: list,
    async text(path: string): Promise<string> {
      const file = await resolveHandle(path);
      return (await file.getFile()).text();
    },
    async file(path: string): Promise<File> {
      const file = await resolveHandle(path);
      return file.getFile();
    },
  };
}

/** 目录 input 给的相对路径（`webkitRelativePath`；缺省退回文件名） */
function relativePathOf(file: File): string {
  const raw = (file as { webkitRelativePath?: string }).webkitRelativePath;
  const path = raw !== undefined && raw !== "" ? raw : file.name;
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** 目录 input 取径：路径剥资源根前缀，文件按逻辑路径查表 */
export async function createFileListFileSource(
  files: readonly File[],
): Promise<ProjectFileSource> {
  const entries = new Map<string, File>();
  for (const file of files) {
    const path = relativePathOf(file);
    const segments = path.split("/");
    const last = segments[segments.length - 1] ?? "";
    if (isDotName(last)) continue;
    entries.set(path, file);
  }
  const { root } = locateResourceRootFromPaths([...entries.keys()]);
  const rootSegments = root === "" ? [] : root.replace(/\/$/, "").split("/");
  const rootName = rootSegments[rootSegments.length - 1] ?? "Resources";
  const relative = new Map<string, File>();
  const all = [...entries.entries()];
  for (const [path, file] of all) {
    const segments = path.split("/");
    if (segments.length <= rootSegments.length) continue;
    const prefix = segments.slice(0, rootSegments.length).join("/");
    if (prefix !== root.replace(/\/$/, "")) continue;
    relative.set(segments.slice(rootSegments.length).join("/"), file);
  }
  const paths = [...relative.keys()].sort();
  const lookup = (path: string): File => {
    const file = relative.get(normalizeResourceId(path));
    if (file === undefined) throw new Error(`资源不存在：${path}`);
    return file;
  };
  return {
    name: rootName,
    async paths(): Promise<readonly string[]> {
      return paths;
    },
    async text(path: string): Promise<string> {
      return lookup(path).text();
    },
    async file(path: string): Promise<File> {
      return lookup(path);
    },
  };
}
