/**
 * 编辑器宿主注入契约（组合根 → 视图族）。
 *
 * 平台取径归组合根：目录选择、文件读取、资源供数都在 `main.ts` 装配，
 * 组件只吃这里声明的契约类型，不 import 适配器实现。
 */
import type {
  AudioPort,
  DegradedOpen,
  DiagnosticSupply,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  VideoPort,
  WriteNormalizationFinding,
} from "@lingfan/engine";

/** 「打开工程」的结果：已组装的故事 + 该工程的资源供给端口（+ 资源根名，供界面显示） */
export interface OpenedProject {
  /** 资源根名（如 `Resources`） */
  root: string;
  story: Story;
  resourcePort: ResourcePort;
  /**
   * 按逻辑路径读资源原始文本（`ResourcePort` 只给 Blob URL，读不了 JSON 文本）。
   * 失败（不存在 / 不可读）**必须抛错**——调用方 fail-closed，不静默降级为空。
   */
  readText: (path: string) => Promise<string>;
  /** 保存单个文本资源（译文表 / 清单）：只落该文件，不产删除、不改其他文件。缺省 = 无写权限 */
  saveText?: (path: string, text: string) => Promise<ProjectWriteReport>;
  /** 层级表：内建默认 × 工程覆盖（`project.json shell.layers`）；预览靠它把实例级 z 与层默认解析成真实 z */
  layerZ: LayerZTable;
  /** 诊断供给侧：资源根实际文件集合（逻辑路径）+ overlay 译文键（并集 + 分语言） */
  diagnosticSupply: DiagnosticSupply;
  /** 保存回磁盘：组合根绑定的闭包，已含原始清单、打开基线与 writer。缺省 = 只读取径，宿主须禁用保存 */
  save?: (story: Story) => Promise<ProjectWriteReport>;
  /** 保存单个列文件：只落该列，不产删除、不改清单。不能走 `save`——那是整工程序列化器，喂单列树会删掉其余列文件 */
  saveColumn?: (columnId: string, columnStory: Story) => Promise<ProjectWriteReport>;
  /** 保存前规范化检测：返回保存将触发的动作，无发现返回 `undefined`；会话内首次成功保存后恒为 `undefined`。缺省 = 只读取径 */
  inspectSave?: (story: Story) => WriteNormalizationFinding | undefined;
  /** 最近一次写回的落盘回执（列 id → 实际路径；未保存过 ⇒ `null`），供新建列得知自己落在哪个文件。缺省 = 宿主不提供 */
  writtenPaths?: () => ReadonlyMap<string, string> | null;
  /** 不可保存时的可操作提示（按钮 title / 提示条） */
  saveHint?: string;
  /** 降级打开回执：资源根缺 `project.json` ⇒ 引擎合成最小清单打开（结构损坏不在此列——那些根本打不开）。降级必须显式告知，不静默处理 */
  degraded?: DegradedOpen;
}

/**
 * 「记住上次工程」：组合根从 IndexedDB 句柄装配的一键重开入口。
 * 有上次工程才出现（缺省 = 按钮不渲染，语义与「未打开工程」一致）。
 */
export interface LastProjectEntry {
  /** 上次工程的目录名（按钮文案用，如 `Resources`） */
  name: string;
  /** 重新打开（申请读权限 → 供给 → 组装，含写回绑定）；失败抛**可操作**错误 */
  reopen(): Promise<OpenedProject | undefined>;
}

/**
 * 「打开工程」能力：两种取径（File System Access 目录句柄 / 目录 input 文件快照）
 * 都经此注入——组件不知道也别知道两者的差别。
 */
export interface ProjectOpener {
  /** 首选取径是否可用；不可用时宿主走目录 input 兜底 */
  supportsPicker: boolean;
  /** 选目录 → 供给 → 组装；用户取消返回 `undefined`（不视作错误），失败抛错（含可操作原因） */
  pick(): Promise<OpenedProject | undefined>;
  /** 目录 input 兜底取径（`<input webkitdirectory>` 文件快照，只读） */
  fromFiles(files: readonly File[]): Promise<OpenedProject>;
  /** 「记住上次工程」：有持久化句柄才出现 */
  lastProject?: LastProjectEntry;
}

/** 媒体端口工厂：端口实例的创建时机归宿主，实现在组合根 */
export interface MediaPortFactories {
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}
