/**
 * 工程文件形态契约：写回产物、差量、文件指纹与规范化发现。
 *
 * 数据层产出这些形状，适配器据此落盘，编辑器据此展示与记账——三方共用同一份定义。
 */

/** 期望文件全集（逻辑路径相对资源根 → 完整文本；键按码元序） */
export interface SerializedProject {
  readonly files: Map<string, string>;
  /**
   * **列 id → 本次实际落盘路径**（写回回执）。
   *
   * **为什么不回填进 `StoryColumn.sourcePath`**：`sourcePath` 是编辑期记账，
   * 塞进 Story 会让「内存态」与「序列化往返结果」不再深等（每次保存都多一个字段），
   * 且**重命名**时它会跟着变——但「这列落在哪个文件」是**写回的事实**，不是列的属性。
   * 归入回执 ⇒ Story 保持纯语义，往返仍深等。
   *
   * 用途：编辑器保存后据此更新自己的记账（下次保存不必再猜）。
   */
  readonly written: ReadonlyMap<string, string>;
}

/** 工程写回差量：要写什么、要删什么 */
export interface ProjectFileDiff {
  /** 需写入（新增或内容不同）；键按码元序 */
  readonly changes: Map<string, string>;
  /** 需删除的陈旧故事文件（仅 `Stories/**`）；码元序 */
  readonly deletes: readonly string[];
}

/** 文件指纹（FSA `File` 与 Rust `metadata` 都能给出的最小面）——写回冲突检测用 */
export interface FileStamp {
  lastModified: number;
  size: number;
}

/**
 * 保存将触发的「规范化」动作（文件级）。列序按 id 固化与 `Stories/` 空目录不清理
 * 没有文件级证据，由界面静态文案一并说明。
 */
export interface WriteNormalizationFinding {
  /** `.story` 文本形态 → 将被同名 JSON 列文件替换（内容等价转换，原文件移除） */
  readonly toConvert: readonly string[];
  /** 其余非规范文件 → 保存后将从磁盘移除（多列拆分 / 文件名与列 id 不一致 / 不再被引用） */
  readonly toRemove: readonly string[];
}
