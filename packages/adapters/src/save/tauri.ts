/**
 * SavePort 原生实现（Tauri Desktop/Mobile 同一 invoke API）：
 * 安全校验全在 Rust 层（加密/AAD/高水位），本侧只做命令编组。
 * 由组合根按平台装配；与 Rust 通信经 Tauri 桥接域的缺省实现，本文件不直连 Tauri 运行时。
 * invoke 可注入（缺省取 Tauri 桥接域的缺省实现）：测试以契约替身注入。
 */
import type { SavePort, SlotSummary } from "@lingfan/engine";
import { defaultInvoke, type TauriInvoke } from "../platform";

/** Rust `save_list` 的返回行（snake_case；本侧映射成引擎的 camelCase 槽位摘要） */
interface RustSlotSummary {
  slot: string;
  save_count: number;
  timestamp: number;
  mode: string;
}

/**
 * 造一个存档端口（桌面/移动原生）：读写删列都转发给 Tauri 的
 * `save_write`/`save_read`/`save_delete`/`save_list` 命令，加密、校验与回档保护都在 Rust 侧。
 * 列表把 Rust 的 snake_case 字段翻成引擎要的 camelCase；`invoke` 可注入以便测试不连运行时。
 */
export function createTauriSavePort(
  invoke: TauriInvoke = defaultInvoke,
): SavePort {
  return {
    async write(slot, payload, mode): Promise<void> {
      await invoke("save_write", { slot, payload, mode });
    },
    async read(slot): Promise<string> {
      return await invoke<string>("save_read", { slot });
    },
    async remove(slot): Promise<void> {
      await invoke("save_delete", { slot }); // 删档不动高水位
    },
    async list(): Promise<SlotSummary[]> {
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
