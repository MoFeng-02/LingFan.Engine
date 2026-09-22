/**
 * 05 §五 存档端口适配器：Tauri invoke（K7——加密/AAD/高水位校验全在 Rust 层）；
 * 浏览器 vite dev 无 Tauri 环境，用 localStorage 演示兜底（明文、仅演示，K 系锚点由 Rust cargo test 锁定）。
 */
import type { SaveMode, SavePort, SlotSummary } from "../engine/contracts";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface RustSlotSummary {
  slot: string;
  save_count: number;
  timestamp: number;
  mode: string;
}

class TauriSavePort implements SavePort {
  async write(slot: string, payload: string, mode: SaveMode): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_write", { slot, payload, mode });
  }

  async read(slot: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("save_read", { slot });
  }

  async list(): Promise<SlotSummary[]> {
    const { invoke } = await import("@tauri-apps/api/core");
    const rows = await invoke<RustSlotSummary[]>("save_list");
    return rows.map((r) => ({
      slot: r.slot,
      saveCount: r.save_count,
      timestamp: r.timestamp,
      mode: r.mode,
    }));
  }
}

/** 演示兜底：语义对齐（高水位/计数），但明文存储——不作为安全边界 */
class LocalStorageSavePort implements SavePort {
  private static hwKey = "lf3-demo:highwater";

  private key(slot: string): string {
    return `lf3-demo:${slot}`;
  }

  async write(slot: string, payload: string, mode: SaveMode): Promise<void> {
    const highWater = Number(
      localStorage.getItem(LocalStorageSavePort.hwKey) ?? "0",
    );
    const saveCount = highWater + 1;
    localStorage.setItem(
      this.key(slot),
      JSON.stringify({ payload, saveCount, timestamp: Date.now(), mode }),
    );
    localStorage.setItem(LocalStorageSavePort.hwKey, String(saveCount));
  }

  async read(slot: string): Promise<string> {
    const raw = localStorage.getItem(this.key(slot));
    if (raw === null) throw new Error(`槽位不存在：${slot}`);
    const record = JSON.parse(raw) as { payload: string; saveCount: number };
    const highWater = Number(
      localStorage.getItem(LocalStorageSavePort.hwKey) ?? "0",
    );
    if (record.saveCount < highWater)
      throw new Error("回档尝试被拒绝（演示高水位）");
    return record.payload;
  }

  async list(): Promise<SlotSummary[]> {
    const out: SlotSummary[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key === null ||
        !key.startsWith("lf3-demo:") ||
        key === LocalStorageSavePort.hwKey
      ) {
        continue;
      }
      const record = JSON.parse(localStorage.getItem(key) ?? "{}") as {
        saveCount?: number;
        timestamp?: number;
      };
      out.push({
        slot: key.slice("lf3-demo:".length),
        saveCount: record.saveCount ?? 0,
        timestamp: record.timestamp ?? 0,
        mode: "demo",
      });
    }
    return out;
  }
}

export function createSavePort(): SavePort {
  return isTauri() ? new TauriSavePort() : new LocalStorageSavePort();
}
