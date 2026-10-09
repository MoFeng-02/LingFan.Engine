/**
 * 目录选择（File System Access）：取径是否可用，以及由用户手势触发的目录选择。
 * 不可用时宿主应走目录 input 的只读文件快照兜底。
 */

/** 目录选择器（`showDirectoryPicker` 尚未进 lib.dom：只声明我们用到的这一面） */
interface DirectoryPickerHost {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

/** 取宿主 `window` 的目录选择器面（`showDirectoryPicker` 未进 lib.dom，故在此窄化） */
function pickerHost(): DirectoryPickerHost {
  return window as unknown as DirectoryPickerHost;
}

/** FSA 取径是否可用（不可用 → 宿主应走目录 input 兜底） */
export function supportsDirectoryPicker(): boolean {
  return typeof pickerHost().showDirectoryPicker === "function";
}

/**
 * 选择工程目录（必须由用户手势触发）。用户取消 → `undefined`（不视作错误）；
 * 其余失败原样抛出（权限/平台异常不吞）。
 */
export async function pickProjectDirectory(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  const pick = pickerHost().showDirectoryPicker;
  if (pick === undefined) return undefined;
  try {
    // mode=read：打开只要读权限；写权限留到「保存」时按需申请（不提前要权限）
    return await pick.call(window, { id: "lingfan-project", mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return undefined;
    }
    throw error;
  }
}
