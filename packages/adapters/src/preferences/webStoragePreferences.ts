/**
 * 08 §八.2 玩家偏好持久化（浏览器/WebView 演示兜底）：localStorage 明文 JSON。
 * 缺失/解析失败 → null（默认值起航）；数据信任边界在 PlayerPreferences.hydrate。
 */
import type { PlayerPrefsData, PreferencesPort } from "@lingfan/engine";

const STORAGE_KEY = "lingfan.prefs.v1";

export function createWebStoragePreferencesPort(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): PreferencesPort {
  return {
    async load(): Promise<PlayerPrefsData | null> {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as PlayerPrefsData;
      } catch {
        return null; // 损坏 = 无偏好（默认值起航，不炸启动）
      }
    },
    async save(data: PlayerPrefsData): Promise<void> {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
  };
}
