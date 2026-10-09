/**
 * Tauri 桌面写回端口（`ProjectWriterPort` 的 Tauri 实现）：
 * 与浏览器 `createHandleProjectWriter` **同构**——差量计算归引擎 `diffProjectFiles`
 * （格式知识单点），本适配器把差量交给 Rust `apply_project_files`（同序落盘：
 * 校验 → 建 `Stories/` → 写列 → 写清单 → 删陈旧；纵深校验在 Rust 侧独立成立）。
 * 基线语义与浏览器一致：失败不更新基线 → 重试幂等；成功才换基线。
 * invoke 可注入 → 契约替身测试 + bridge_check 互锁。
 *
 * 根路径来源 = 编辑器 Tauri 形态打开工程时的 dialog 所选目录（浏览器 FSA 句柄
 * 自带根，故浏览器实现不需要此参数——同一契约，取径差异归宿主）。
 *
 * **并发修改检测**：与 FSA 侧同构——构造 / 每次保存成功后对基线文件集
 * `stamp_project_files` 采指纹（Rust metadata：mtime 毫秒 + size，**缺失路径不返回**），
 * `apply` 落盘前重采比对（引擎 `detectWriteConflicts`），外部改动/删除 → 抛
 * `conflictMessage`（零写入）。工厂为 **async**（首次指纹采集在对任何写操作可见之前），
 * 与 `createHandleProjectWriter` 的 async 形态对称。
 *
 * 写回不变量：先写后删、manifest 是提交点（与 Rust 侧逐字节同构）。
 */
import {
  conflictMessage,
  detectWriteConflicts,
  diffProjectFiles,
  type FileStamp,
  type ProjectWriteReport,
  type ProjectWriterPort,
} from "@lingfan/engine";
import { defaultInvoke, type TauriInvoke } from "../platform";

/** 原生写回端口的装配参数（测试可注入 invoke 替身，不连 Tauri 运行时） */
export interface TauriProjectWriterOptions {
  /** invoke 可注入（测试替身）；缺省 = 真实 Tauri invoke（动态 import） */
  invoke?: TauriInvoke;
}

/** Rust 负载形状（`ProjectWriterError` 归一后 message 直接可操作） */
interface RawWriteReport {
  written?: unknown;
  deleted?: unknown;
}

/** 类型守卫：Rust 返回的数组必须逐项是字符串才当作路径列表用 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 校验 Rust 写回负载并取回已写/已删路径；形状非法即抛错（不假装成功） */
function normalizeReport(payload: unknown): ProjectWriteReport {
  if (payload === null || typeof payload !== "object") {
    throw new Error("写回返回了不可识别的负载（fail-closed）");
  }
  const raw = payload as RawWriteReport;
  if (!isStringArray(raw.written) || !isStringArray(raw.deleted)) {
    throw new Error("写回报告形状非法（written/deleted 必须为字符串数组）");
  }
  return { written: raw.written, deleted: raw.deleted };
}

/** 指纹负载 → 指纹表：形状非法逐项跳过（缺项 = 比对时的冲突信号，不伪造） */
async function readStamps(
  invoke: TauriInvoke,
  root: string,
  paths: readonly string[],
): Promise<Map<string, FileStamp>> {
  const payload = (await invoke("stamp_project_files", {
    root,
    paths: [...paths],
  })) as unknown;
  if (payload === null || typeof payload !== "object") {
    throw new Error("指纹返回了不可识别的负载（fail-closed）");
  }
  const raw = (payload as { stamps?: unknown }).stamps;
  if (!Array.isArray(raw)) {
    throw new Error("指纹负载形状非法（stamps 必须为数组）");
  }
  const stamps = new Map<string, FileStamp>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { path, lastModified, size } = entry as Record<string, unknown>;
    if (
      typeof path === "string" &&
      typeof lastModified === "number" &&
      typeof size === "number"
    ) {
      stamps.set(path, { lastModified, size });
    }
  }
  return stamps;
}

/**
 * 造一个写回端口（桌面/移动原生）：差量交给引擎算，落盘交给 Rust `apply_project_files`。
 * `root` 是打开工程时对话框选中的目录；`previous` 是打开时的基线文件集。
 * 造端口时先采一遍基线指纹（因此是 async），之后每次保存都先比对指纹，外部改动会让保存
 * 抛错且零写入；只有写成功才换基线，于是重复保存幂等。
 */
export async function createTauriProjectWriter(
  root: string,
  previous: ReadonlyMap<string, string>,
  options?: TauriProjectWriterOptions,
): Promise<ProjectWriterPort> {
  const invoke = options?.invoke ?? defaultInvoke;
  let baseline = new Map(previous);
  let stamps = await readStamps(invoke, root, [...baseline.keys()]);
  return {
    writable: true,
    async apply(files: ReadonlyMap<string, string>): Promise<ProjectWriteReport> {
      const { changes, deletes } = diffProjectFiles(files, baseline);
      // 并发检测：任何落盘之前重采基线指纹比对（外部改动/删除 → 冲突，零写入）
      const current = await readStamps(invoke, root, [...stamps.keys()]);
      const conflicted = detectWriteConflicts(stamps, current);
      if (conflicted.length > 0) {
        throw new Error(conflictMessage(conflicted));
      }
      const payload = normalizeReport(
        await invoke("apply_project_files", {
          root,
          changes: [...changes].map(([path, text]) => ({ path, text })),
          deletes: [...deletes],
        }),
      );
      baseline = new Map(files); // 成功才更新基线 → 二次保存不重复写
      stamps = await readStamps(invoke, root, [...baseline.keys()]); // 快照换新
      return payload;
    },
  };
}