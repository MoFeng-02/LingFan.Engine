/**
 * 存档编排契约（TS 侧）：安全（加密/AAD/高水位）在 Rust 层。
 * TS 只编排载荷与槽位；跨端（Desktop/Mobile）实现同一 SavePort。
 *
 * 演进约束（固定）：载荷字段**只增不改**；破坏性变更必须升 `formatVersion`
 * 并同时提供 `migrateSave` 迁移路径——旧档读不了 = 引擎违约。
 */
import type { ColumnCoordinate, StoryCommand } from "./story";

/** 存档载荷 v1（块/列级作用域不进档——读档后按坐标确定性重放重建） */
export interface SaveDataV1 {
  formatVersion: 1;
  storyId: string;
  /** 存档标题（save op 的 title 参数，槽位列表展示用；可选） */
  title?: string;
  /** 等待点命令坐标：读档时从该命令重放，重建等待画面 */
  coord: ColumnCoordinate;
  state: [string, unknown][];
  rngState: number;
  functions: [string, { params: string[]; body: StoryCommand[] }][];
  /** 检查点序列随档，读档后可继续回溯 */
  cursor: number;
  /** 存档缩略图（data URL，槽位面板展示用；可选——旧档无此字段） */
  screenshot?: string;
  /**
   * 存档扩展依赖标记：本档实际执行过的扩展（op 执行时登记，`exportSave` 落盘）。
   * 未用到扩展的存档**不带本字段**（缺扩展也能读——防假阳性）；读档时逐个查注册表，
   * 缺 id / 版本不可达且无 migrate → 整档拒绝（`extension-missing` / `extension-version`）。
   */
  extensions?: { id: string; stateVersion: number }[];
  /**
   * 生成本档时的故事版本（config.ts 作者声明的 `version`，缺省 1）。
   * 读档时与当前故事**声明**的 `version` 比对（当前故事未声明则不对账，
   * 存量档直读）：不一致且宿主提供了 `migrateState` 钩子 → 迁移；
   * 无钩子 → 整档拒绝（`save-story-version`）。旧档无此字段 = 按 0 处理。
   */
  storyVersion?: number;
  /**
   * 墓碑：本档执行过 `undef` 且删除落在全局层的状态键（帧层 undef 不记）。
   * 读档垫底（story.defines 默认值补齐）据此跳过这些键——「作者主动销毁」与
   * 「旧档缺键」两种缺失必须区分，否则 undef 后读档默认值会复活。
   */
  deleted?: string[];
  /**
   * 玩法系统依赖标记：本档实际回填过状态的玩法系统（`resolveMinigame` 登记落盘）。
   * 语义与 `extensions` 同构：缺玩法系统注册 → `minigame-missing` 拒绝；
   * 版本不可达且无 migrate → `minigame-version` 拒绝。未用到玩法系统的存档不带本字段。
   */
  minigames?: { id: string; stateVersion: number }[];
  history: Array<{
    coord: ColumnCoordinate;
    state: [string, unknown][];
    rngState: number;
  }>;
}

/** 存档模式：MachineBound 默认（跨机不可解）/ Portable 可选（仅存档） */
export type SaveMode = "machine-bound" | "portable";

/** 存档附加项（引擎 save 的可选载荷增强；undefined 字段不进档） */
export interface SaveOptions {
  /** 存档标题（槽位面板展示） */
  title?: string;
  /** 存档缩略图（data URL，由宿主合成——渲染层截图策略归宿主） */
  screenshot?: string;
}

/** 槽位摘要（Rust save_list 头部解析，适配器已转驼峰） */
export interface SlotSummary {
  slot: string;
  saveCount: number;
  timestamp: number;
  mode: string;
}

/** 存档端口：实现 = infra 适配器（Tauri Desktop/Mobile invoke / Web 演示兜底） */
export interface SavePort {
  write(slot: string, payload: string, mode: SaveMode): Promise<void>;
  read(slot: string): Promise<string>;
  /** 删除槽位（删档不动高水位——防回档基准不随删档回退） */
  remove(slot: string): Promise<void>;
  list(): Promise<SlotSummary[]>;
}
