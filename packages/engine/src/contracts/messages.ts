/**
 * 引擎用户可见文案表：运行期产生的玩家可见消息（存读档失败、存档被拒、
 * 循环上限中断、插值兜底等）的集中声明与缺省实现。
 *
 * 集中在契约层的原因：宿主（不同平台 / 发行地区）需要整体替换玩家可见文案
 * 而无须改引擎源码。缺省实现即引擎的缺省文案，不传 texts 时引擎行为不变。
 */

/** 引擎用户可见文案表（每个用户可见模板一个具名方法；参数 = 模板插值位） */
export interface EngineTexts {
  /** call 落在场景列时的可操作拒绝 */
  callSceneColumn(name: string): string;
  /** 插值求值失败，保留原文兜底（dialog / media / stage 三处共用） */
  interpolationFallback(error: string): string;
  /** 槽位写档失败（命令面与自动快照两处共用） */
  saveWriteFailed(slot: string, error: string): string;
  /** 槽位读档失败：读取或解析抛出（命令面 load） */
  loadReadFailed(slot: string, error: string): string;
  /** 某语言译文 overlay 加载失败，保持原语言 */
  i18nLoadFailed(lang: string, error: string): string;
  /** 循环迭代超上限，已中断（防死循环安全网） */
  loopLimitExceeded(limit: number): string;
  /** 自动存档写入失败（auto 槽） */
  autoSaveWriteFailed(error: string): string;
  /** 当前不在等待点，无法存档 */
  saveNotAtWaitPoint(): string;
  /** 状态含不可序列化值，存档被拒 */
  saveUnsafeValue(value: string): string;
  /** 菜单/界面中无可返回游戏进度，无法存档 */
  saveNothingToSave(): string;
  /** 存档故事版本与当前故事不一致且未配置 migrateState */
  saveStoryVersionMismatch(saveVersion: number, currentVersion: number): string;
  /** migrateState 无法迁移（返回 null 或抛出） */
  saveMigrateFailed(saveVersion: number, currentVersion: number): string;
  /** 存档状态已迁移（load.notice 通知串） */
  saveMigrated(from: number, to: number): string;
  /** 存档格式版本不支持（tryMigrateSave 的可操作拒绝） */
  saveFormatVersionUnsupported(fromVersion: string): string;
  /** 存档格式迁移成功（load.notice 通知串） */
  saveFormatMigrated(fromVersion: string): string;
  /** 存档依赖的扩展未注册 */
  extensionMissing(id: string): string;
  /** 扩展状态版本迁移失败 */
  extensionMigrateFailed(id: string, from: number, to: number): string;
  /** 扩展状态迁移成功（load.notice 通知串） */
  extensionMigrated(id: string, from: number, to: number): string;
  /** 扩展状态版本依赖不满足（档新于引擎注册版本） */
  extensionVersionDependency(id: string, saveVersion: number, registered: number): string;
  /** 扩展 restore 返回 false */
  extensionRestoreFailed(id: string): string;
  /** 存档依赖的玩法系统未注册 */
  minigameMissing(id: string): string;
  /** 玩法系统状态版本迁移失败 */
  minigameMigrateFailed(id: string, from: number, to: number): string;
  /** 玩法系统状态迁移成功（load.notice 通知串） */
  minigameMigrated(id: string, from: number, to: number): string;
  /** 玩法系统状态版本依赖不满足 */
  minigameVersionDependency(id: string, saveVersion: number, registered: number): string;
  /** 磁盘已被外部修改，保存将覆盖（保存冲突提示） */
  saveConflict(head: string, more: string): string;
  /** 工程组装失败（整次拒绝；issues 逐条列出失败原因） */
  projectAssembly(issues: readonly string[]): string;
  /** 工程写回失败（整次拒绝；issues 逐条列出失败原因） */
  projectSerialization(issues: readonly string[]): string;
  /** 文本投影失败（整次拒绝；issues 逐条带源定位） */
  textFormat(issues: readonly string[]): string;
  /** 故事 JSON 解析失败（整次拒绝；issues 逐条带源定位） */
  storyFormat(issues: readonly string[]): string;
}

/**
 * 缺省文案（引擎不注入 texts 时的实际取值）。
 * 这些串多为玩家可见错误信息，改动措辞前先确认没有测试断言其内容。
 */
export const defaultEngineTexts: EngineTexts = {
  callSceneColumn: (name) =>
    `call 只能调用流程列（flow）；${name} 是场景列（scene）——空间层切换请用 navigate/jump`,
  interpolationFallback: (error) => `插值失败（保留原文）：${error}`,
  saveWriteFailed: (slot, error) => `槽位 ${slot} 写档失败：${error}`,
  loadReadFailed: (slot, error) => `槽位 ${slot} 读取或解析失败：${error}`,
  i18nLoadFailed: (lang, error) => `载入 ${lang} 译文 overlay 失败（保持原语言）：${error}`,
  loopLimitExceeded: (limit) => `循环迭代超过 ${limit} 次上限，已中断（防死循环安全网）`,
  autoSaveWriteFailed: (error) => `自动存档写入失败：${error}`,
  saveNotAtWaitPoint: () => `当前不在等待点，无法存档`,
  saveUnsafeValue: (value) => `状态含不可序列化值，存档被拒：${value}`,
  saveNothingToSave: () => `菜单/界面中无可返回游戏进度，无法存档`,
  saveStoryVersionMismatch: (saveVersion, currentVersion) =>
    `存档故事版本 v${saveVersion} 与当前故事 v${currentVersion} 不一致，且未配置 migrateState 钩子。请在构造引擎时提供 migrateState 完成状态迁移`,
  saveMigrateFailed: (saveVersion, currentVersion) =>
    `migrateState 钩子无法把存档从故事版本 v${saveVersion} 迁移到 v${currentVersion}，存档被拒绝`,
  saveMigrated: (from, to) =>
    `存档状态已从故事版本 v${from} 迁移到 v${to}（migrateState）`,
  saveFormatVersionUnsupported: (fromVersion) =>
    `存档格式版本不支持：档为 v${fromVersion}，引擎为 v1。请用创建该存档的引擎版本打开，或在构造引擎时提供 migrateSave 钩子完成版本迁移`,
  saveFormatMigrated: (fromVersion) =>
    `存档已从 v${fromVersion} 迁移到 v1（migrateSave）`,
  extensionMissing: (id) => `存档依赖的扩展未注册：「${id}」。请安装并启用该扩展后再读档`,
  extensionMigrateFailed: (id, from, to) =>
    `扩展「${id}」无法从状态版本 v${from} 迁移到 v${to}，存档被拒绝`,
  extensionMigrated: (id, from, to) =>
    `扩展「${id}」状态已从 v${from} 迁移到 v${to}`,
  extensionVersionDependency: (id, saveVersion, registered) =>
    `存档依赖扩展「${id}」的状态版本 v${saveVersion}，当前注册版本为 v${registered}（存档过新或缺少迁移路径），存档被拒绝`,
  extensionRestoreFailed: (id) =>
    `扩展「${id}」读档恢复失败（restore 返回 false），存档被拒绝`,
  minigameMissing: (id) => `存档依赖的玩法系统未注册：「${id}」。请注册该玩法系统后再读档`,
  minigameMigrateFailed: (id, from, to) =>
    `玩法系统「${id}」无法从状态版本 v${from} 迁移到 v${to}，存档被拒绝`,
  minigameMigrated: (id, from, to) =>
    `玩法系统「${id}」状态已从 v${from} 迁移到 v${to}`,
  minigameVersionDependency: (id, saveVersion, registered) =>
    `存档依赖玩法系统「${id}」的状态版本 v${saveVersion}，当前注册版本为 v${registered}（存档过新或缺少迁移路径），存档被拒绝`,
  saveConflict: (head, more) =>
    `磁盘已被外部修改（${head}${more}）：现在保存将覆盖这些改动。请先重新打开工程确认，或放弃本次保存。`,
  projectAssembly: (issues) => `工程组装失败（整次拒绝）：\n- ${issues.join("\n- ")}`,
  projectSerialization: (issues) =>
    `工程写回失败（整次拒绝）：\n- ${issues.join("\n- ")}`,
  textFormat: (issues) => `文本投影失败（整次拒绝）：\n- ${issues.join("\n- ")}`,
  storyFormat: (issues) => `故事 JSON 解析失败（整次拒绝）：\n- ${issues.join("\n- ")}`,
};
