/**
 * 编辑器宿主注入契约（组合根 → 视图族）。
 *
 * 约束（调用链分层）：**平台取径归组合根**——目录选择、文件读取、资源供数
 * 都在 `main.ts` 装配，组件只吃这里声明的契约类型（组件零 adapters import，
 * 与 playground 同构）。
 */
import type {
  AudioPort,
  DegradedOpen,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  VideoPort,
  WriteNormalizationFinding,
} from "@lingfan/engine";
import type { DiagnosticSupply } from "@lingfan/adapters";

/** 「打开工程」的结果：已组装的故事 + 该工程的资源供给端口（+ 资源根名，供界面显示） */
export interface OpenedProject {
  /** 资源根名（如 `Resources`） */
  root: string;
  story: Story;
  resourcePort: ResourcePort;
  /**
   * **按逻辑路径读资源原始文本**（资源管理器的通用读取能力）。
   *
   * 为何必需：`ResourcePort` 只给 Blob URL（媒体播放用），读不了 JSON 文本；
   * 而资源管理器的非故事视图（译文表 / 工程清单 / 生成型产物）都要看内容。
   * 底层复用 `ProjectFileSource.text`（既有能力，任意资源根内路径皆可），
   * 组合根绑定闭包注入 ⇒ 组件零 adapters import（与 `save` 同一约束）。
   *
   * 失败（不存在 / 不可读）**必须抛错** —— 调用方 fail-closed，不静默降级为空。
   */
  readText: (path: string) => Promise<string>;
  /**
   * 保存**单个文本资源**（译文表 / 清单）：只落该文件，**不产删除、不改其他文件**。
   *
   * 与 `save`（整工程）并列而非替代：资源管理器按文件操作，整工程写回是
   * 「打开工程」这条路。二者作用域不同，混用会误伤未编辑的文件。
   */
  saveText?: (path: string, text: string) => Promise<ProjectWriteReport>;
  /**
   * 层级表：内建默认 × 工程覆盖（`project.json shell.layers`）。
   * 预览需要它才能把「实例级 z」与「层默认」解析成真实 z（否则只能按 DOM 顺序叠）。
   */
  layerZ: LayerZTable;
  /**
   * 诊断供给侧：资源根实际文件集合（逻辑路径）+ overlay 译文键（并集 + 分语言）。
   *
   * 类型**直接引用供给侧**（`@lingfan/adapters` 的 `DiagnosticSupply`）——
   * 若声明成 `Required<AnalyzeOptions>` 并自称「同一类型」，供给侧加字段后
   * 它**并不会跟着变** ⇒ 注释在骗人、两处声明漂移（本地化工作台接 `overlayKeysByLang`
   * 时才暴露）。**判据只增的字段**（`AnalyzeOptions` 只喂 `analyzeStory`）不该
   * 决定供给侧的形状 ⇒ 两者是**不同的类型**，各自诚实声明。
   */
  diagnosticSupply: DiagnosticSupply;
  /**
   * 保存回磁盘：组合根绑定的闭包——已含**原始清单**（保真回写 `project.json`）、
   * 打开基线（算最小差量）与 writer。组件不持有这些平台侧事实。
   * 缺省 = 只读取径（目录 input 快照）→ 宿主必须禁用保存。
   */
  save?: (story: Story) => Promise<ProjectWriteReport>;
  /**
   * 保存**单个资源文档**（多文档面）：只落该列文件，**不产删除、不改清单**。
   *
   * 为何不能走 `save`：那是整工程序列化器，喂单列树会把其余列文件判为陈旧并删除
   * （`serializeColumnDocument` 的回归测试锁住了该边界）。缺省 = 无写权限。
   */
  saveColumn?: (columnId: string, columnStory: Story) => Promise<ProjectWriteReport>;
  /**
   * 保存前规范化检测：对比**当前磁盘形态**
   * 与当前故事的标准布局，返回保存将触发的规范化动作；无发现返回 `undefined`。
   * 会话内**首次成功保存**后恒返回 `undefined`（打开时的非规范文件已被处理）。
   * 缺省 = 只读取径（无保存能力，检测无从谈起）。
   */
  inspectSave?: (story: Story) => WriteNormalizationFinding | undefined;
  /**
   * 取「最近一次写回的落盘回执」（列 id → 实际路径；未保存过 ⇒ `null`）。
   *
   * 用途：新建列在写回后才知道落在哪个文件（`Stories/<id>.json`），
   * 下次保存不必再猜。**不污染 `Story`**——落盘事实是回执，不是列的属性
   * （塞进 Story 会让「保存后内存态」与「重开态」不再深等）。缺省 = 宿主不提供。
   */
  writtenPaths?: () => ReadonlyMap<string, string> | null;
  /** 不可保存时的可操作提示（按钮 title / 提示条） */
  saveHint?: string;
  /**
   * 降级打开回执：资源根缺 `project.json` ⇒ 引擎合成最小清单打开。
   * `undefined` = 正常打开。**降级必须显式告知**（状态栏「降级打开」+ title 详情），
   * 不许静默假装一切正常；结构损坏不在此列（那些根本打不开）。
   */
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
  /** 「记住上次工程」：有持久化句柄才出现 */
  lastProject?: LastProjectEntry;
}

/** 媒体端口工厂（与 playground 同构：端口实例的创建时机归宿主，实现在组合根） */
export interface MediaPortFactories {
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}