/**
 * 机器级持久数据契约：跨存档共享的「游戏事实」（已读文本等），
 * 独立于玩家偏好（设置）、存档（故事进度）与 SSOT（故事状态）的第四持久层。
 *
 * 为什么单独一层：偏好是「玩的人怎么用这台机器」，存档是「这个故事进行到哪」，
 * 而「哪些文本已经读过」既不属于设置也不属于某一存档——它跨存档共享、删档不清，
 * 是机器级的游戏事实。故不进引擎快照/存档，由 `PersistentPort` 单独落盘。
 * 载荷为纯数据（v1 起版本化，只增），信任边界在 hydrate（逐项校验降级），端口只搬运。
 */

/**
 * 已读记录：say 坐标级集合（columnId → 已读 say 下标升序数组）。
 *
 * 坐标级而非列级：快进判定精确到「这一句读没读过」（与 Ren'Py 同口径），
 * 列级只能粗粒度地「整列读过」。JSON 安全（字符串键 + 整数数组），可序列化落盘。
 */
export type SeenRecord = Record<string, number[]>;

/**
 * 机器级持久数据载荷（契约只增，可选字段向后兼容）。
 * `seen` 恒在（空对象 = 尚未读过任何文本）；后续解锁/画廊等只增字段。
 */
export interface PersistentData {
  v: 1;
  /** 已读 say 坐标集合（跨存档共享；缺省空 = 未读） */
  seen: SeenRecord;
}

/**
 * 持久数据端口（组合根注入；Tauri = app_data JSON 文件，浏览器 = localStorage，小程序 = storage）。
 * 与 PreferencesPort 同口径成对（核心契约 + 宿主适配器）；损坏隔离——读失败返回 null，
 * 不影响存档读取；删档不清本层（跨存档共享语义）。
 */
export interface PersistentPort {
  load(): Promise<PersistentData | null>;
  save(data: PersistentData): Promise<void>;
}

/** 空持久数据（尚未读过任何文本；hydrate 失败/缺端口时的内存基线） */
export const EMPTY_PERSISTENT: PersistentData = { v: 1, seen: {} };
