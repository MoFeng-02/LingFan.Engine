/**
 * 机器级持久数据（Tauri Desktop 原生实现）：invoke Rust
 * `persistent_read`/`persistent_write`（app_data/persistent.json，明文——
 * 已读记录非敏感资产无密钥；数据校验降级归 hydratePersistent）。
 * invoke 可注入（缺省取 Tauri 桥接域的缺省实现）：测试以契约替身注入。
 */
import type { PersistentData, PersistentPort } from "@lingfan-engine/core";
import { defaultInvoke, invokeRust, type TauriInvoke } from "../platform";

/**
 * 造一个持久数据端口（桌面/移动原生）：读调 Rust `persistent_read`，写调 `persistent_write`
 * （落 app_data 下的 persistent.json，明文——已读记录不含密钥）。
 * 缺文件返回 null 由上层取空基线；字段非法由 `hydratePersistent` 兜。
 * 与偏好/存档分文件落盘：损坏隔离，删档不清本层（跨存档共享）。
 */
export function createTauriPersistentPort(
  invoke: TauriInvoke = defaultInvoke,
): PersistentPort {
  return {
    async load(): Promise<PersistentData | null> {
      return (
        (await invokeRust<PersistentData | null>(invoke, "persistent_read")) ??
        null
      );
    },
    async save(data: PersistentData): Promise<void> {
      await invokeRust(invoke, "persistent_write", { data });
    },
  };
}
