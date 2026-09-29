/**
 * 编辑器宿主注入契约（组合根 → 视图族）。
 *
 * 纪律（06-D1 / 宪法 §6 调用链）：**平台取径归组合根**——目录选择、文件读取、资源供数
 * 都在 `main.ts` 装配，组件只吃这里声明的契约类型（组件零 adapters import，
 * 与 playground 同构）。
 */
import type {
  AudioPort,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  VideoPort,
  WriteNormalizationFinding,
} from "@lingfan/engine";
import type { AnalyzeOptions } from "@lingfan/editor";

/** 「打开工程」的结果：已组装的故事 + 该工程的资源供给端口（+ 资源根名，供界面显示） */
export interface OpenedProject {
  /** 资源根名（如 `Resources`） */
  root: string;
  story: Story;
  resourcePort: ResourcePort;
  /**
   * ⑨-11/08 §八.3 层级表：内建默认 × 工程覆盖（`project.json shell.layers`）。
   * 预览需要它才能把「实例级 z」与「层默认」解析成真实 z（否则只能按 DOM 顺序叠）。
   */
  layerZ: LayerZTable;
  /**
   * T02-01 / T02-02 诊断供给侧：资源根实际文件集合（逻辑路径）+ overlay 译文键并集。
   * 类型即 `analyzeStory` 的第二参数（**同一类型** ⇒ 杜绝两处声明漂移）；未打开工程时
   * 宿主不传该参数，两个检查器族整体跳过（不误报）。
   */
  diagnosticSupply: Required<AnalyzeOptions>;
  /**
   * 保存回磁盘（09-16）：组合根绑定的闭包——已含**原始清单**（保真回写 `project.json`）、
   * 打开基线（算最小差量）与 writer。组件不持有这些平台侧事实。
   * 缺省 = 只读取径（目录 input 快照）→ 宿主必须禁用保存。
   */
  save?: (story: Story) => Promise<ProjectWriteReport>;
  /**
   * T03-03 保存前规范化检测（锚点 save-normalization-notice）：对比**当前磁盘形态**
   * 与当前故事的标准布局，返回保存将触发的规范化动作；无发现返回 `undefined`。
   * 会话内**首次成功保存**后恒返回 `undefined`（打开时的非规范文件已被处理）。
   * 缺省 = 只读取径（无保存能力，检测无从谈起）。
   */
  inspectSave?: (story: Story) => WriteNormalizationFinding | undefined;
  /** 不可保存时的可操作提示（按钮 title / 提示条） */
  saveHint?: string;
}

/**
 * 「记住上次工程」（T03-06）：组合根从 IndexedDB 句柄装配的一键重开入口。
 * 有上次工程才出现（缺省 = 按钮不渲染，语义与「未打开工程」一致）。
 */
export interface LastProjectEntry {
  /** 上次工程的目录名（按钮文案用，如 `Resources`） */
  name: string;
  /** 重新打开（申请读权限 → 供给 → 组装，含写回绑定）；失败抛**可操作**错误 */
  reopen(): Promise<OpenedProject | undefined>;
}

/**
 * 「打开工程」能力：两种取径（FSA 目录句柄 / 目录 input 文件快照）都经此注入——
 * 组件不知道也别知道两者的差别。
 */
export interface ProjectOpener {
  /** 首选取径（File System Access 目录句柄）是否可用；不可用时宿主走目录 input 兜底 */
  supportsPicker: boolean;
  /** 选目录 → 供给 → 组装；用户取消返回 `undefined`（不视作错误）；失败抛错（含可操作原因） */
  pick(): Promise<OpenedProject | undefined>;
  /** 目录 input 兜底取径（`<input webkitdirectory>` 的文件快照，只读） */
  fromFiles(files: readonly File[]): Promise<OpenedProject>;
  /** 「记住上次工程」（T03-06）：有持久化句柄才出现 */
  lastProject?: LastProjectEntry;
}

/** 媒体端口工厂（与 playground 同构：端口实例的创建时机归宿主，实现在组合根） */
export interface MediaPortFactories {
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}