/**
 * 写权限与宿主句柄口径（**唯一**一处）：
 * 宿主 API 的 lib.dom 版本不一，这里把用到的面窄化声明一次、把「未获写权限」
 * 归一成同一句用户可见文案，其余文件只准取用本文件的判定，不得各自再判一次——
 * 否则「谁能写」会出现两个口径。
 */
import { normalizeResourceId } from "../../resourcePort";

/**
 * 申请写权限：`queryPermission` 已 granted 直接放行；否则 `requestPermission`。
 * **必须是 `apply()` 里第一个 await**——保存按钮点击是真实用户手势，浏览器要求
 * transient activation 才能弹权限询问；先做别的异步再申请会被拒。
 * 老 Chromium 无 permission API：不预检，由 `createWritable` 的 NotAllowedError 归一。
 */
export async function ensureWriteAccess(
  root: FileSystemDirectoryHandle,
): Promise<void> {
  const dir = asWritableDir(root);
  if (dir.queryPermission !== undefined) {
    if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return;
  }
  if (dir.requestPermission !== undefined) {
    const state = await dir.requestPermission({ mode: "readwrite" });
    if (state === "granted") return;
    throw new Error(WRITE_PERMISSION_HINT);
  }
}

/**
 * 读权限按需申请（「重新打开上次工程」用）：已授权直接放行；未授权在**用户手势内**
 * 申请 `read`（重开按钮点击即手势，与保存链路的写权限申请同一约束）。
 * 部分 Chromium 无 permission API：放行（由后续文件读失败归一）。
 */
export async function ensureReadAccess(
  root: FileSystemDirectoryHandle,
): Promise<boolean> {
  const dir = root as FileSystemDirectoryHandle & {
    queryPermission?: (options: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
    requestPermission?: (options: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
  };
  if (dir.queryPermission !== undefined) {
    if ((await dir.queryPermission({ mode: "read" })) === "granted") return true;
  }
  if (dir.requestPermission === undefined) return true;
  return (await dir.requestPermission({ mode: "read" })) === "granted";
}

/** 未获写权限时的统一可操作文案（requestPermission 被拒 / createWritable 抛 NotAllowedError 同一句） */
const WRITE_PERMISSION_HINT =
  "未获得写入权限：请重新点击「打开工程」选择该目录，并在浏览器询问时选择「允许编辑」";

/** 可写文件句柄（lib.dom 版本不一：只声明我们用到的这一面） */
export interface WritableFileHost {
  createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

/** 可写目录句柄（建文件/建目录/删除/权限查询——一律窄化，避免 lib 漂移） */
export interface WritableDirectoryHost {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
}

/** 把目录句柄收窄成 `WritableDirectoryHost`：调用方只看得见本仓库用到的那些方法 */
export function asWritableDir(handle: FileSystemDirectoryHandle): WritableDirectoryHost {
  return handle as unknown as WritableDirectoryHost;
}

/** 把文件句柄收窄成 `WritableFileHost`：写文件只经 `createWritable` 这一面 */
export function asWritableFile(handle: FileSystemFileHandle): WritableFileHost {
  return handle as unknown as WritableFileHost;
}

/** 写权限被拒的两种表现归一（用户可见文案不分叉） */
export function normalizeWriteError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return new Error(WRITE_PERMISSION_HINT);
  }
  return error;
}

/** 逻辑路径 → 安全段（复用资源路径口径：剥前导斜杠、拒空段与 `..` 逃逸） */
export function safeSegments(path: string): string[] {
  const segments = normalizeResourceId(path).split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\\")) {
      throw new Error(`工程路径非法（越出资源根）：${path}`);
    }
  }
  return segments;
}
