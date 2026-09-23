/**
 * 05 §五 SavePort 原生实现（Tauri Desktop/Mobile 同一 invoke API）：
 * 安全校验全在 Rust 层（K7——加密/AAD/高水位），本侧只做命令编组。
 * 由组合根按平台装配；本文件是全仓唯一允许 import `@tauri-apps` 的位置。
 */
import type { SavePort, SlotSummary } from "@lingfan/engine";

interface RustSlotSummary {
  slot: string;
  save_count: number;
  timestamp: number;
  mode: string;
}

export function createTauriSavePort(): SavePort {
  return {
    async write(slot, payload, mode): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_write", { slot, payload, mode });
    },
    async read(slot): Promise<string> {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("save_read", { slot });
    },
    async list(): Promise<SlotSummary[]> {
      const { invoke } = await import("@tauri-apps/api/core");
      const rows = await invoke<RustSlotSummary[]>("save_list");
      return rows.map((r) => ({
        slot: r.slot,
        saveCount: r.save_count,
        timestamp: r.timestamp,
        mode: r.mode,
      }));
    },
  };
}
