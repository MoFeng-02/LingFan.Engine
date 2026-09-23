/**
 * 08 §八.2 玩家偏好持久化（Tauri Desktop 原生实现）：invoke Rust
 * `preferences_read`/`preferences_write`（app_data/preferences.json，明文——
 * 偏好非敏感资产无密钥；数据校验降级归 PlayerPreferences.hydrate）。
 * invoke 可注入（默认动态 import `@tauri-apps/api/core`）：测试以契约替身注入。
 */
import type { PlayerPrefsData, PreferencesPort } from "@lingfan/engine";
import {
  defaultInvoke,
  type TauriInvoke,
} from "../resources/projectFilesTauri";

export function createTauriPreferencesPort(
  invoke: TauriInvoke = defaultInvoke,
): PreferencesPort {
  return {
    async load(): Promise<PlayerPrefsData | null> {
      return (await invoke<PlayerPrefsData | null>("preferences_read")) ?? null;
    },
    async save(data: PlayerPrefsData): Promise<void> {
      await invoke("preferences_write", { prefs: data });
    },
  };
}
