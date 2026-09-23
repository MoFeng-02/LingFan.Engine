/**
 * 05-存档编排契约（TS 侧）：安全（加密/AAD/高水位）在 Rust 层（K7）。
 * TS 只编排载荷与槽位；跨端（Desktop/Mobile）实现同一 SavePort。
 */
import type { ColumnCoordinate, StoryCommand } from "./story";

/** 05 §四 存档载荷 v1（S3：块/列级作用域不进档——读档后按坐标确定性重放重建） */
export interface SaveDataV1 {
  formatVersion: 1;
  storyId: string;
  /** 等待点命令坐标：读档时从该命令重放，重建等待画面 */
  coord: ColumnCoordinate;
  state: [string, unknown][];
  rngState: number;
  functions: [string, { params: string[]; body: StoryCommand[] }][];
  /** 03-R8：检查点序列随档，读档后可继续回溯 */
  cursor: number;
  history: Array<{
    coord: ColumnCoordinate;
    state: [string, unknown][];
    rngState: number;
  }>;
}

/** 05 §五 K5 存档模式：MachineBound 默认（跨机不可解）/ Portable 可选（仅存档） */
export type SaveMode = "machine-bound" | "portable";

/** 槽位摘要（Rust save_list 头部解析，适配器已转驼峰） */
export interface SlotSummary {
  slot: string;
  saveCount: number;
  timestamp: number;
  mode: string;
}

/** 05 §五 存档端口：实现 = infra 适配器（Tauri Desktop/Mobile invoke / Web 演示兜底） */
export interface SavePort {
  write(slot: string, payload: string, mode: SaveMode): Promise<void>;
  read(slot: string): Promise<string>;
  list(): Promise<SlotSummary[]>;
}
