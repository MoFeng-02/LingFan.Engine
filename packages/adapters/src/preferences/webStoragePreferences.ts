/**
 * 玩家偏好持久化（浏览器/WebView 演示兜底）：localStorage 明文 JSON。
 * 缺失/解析失败 → null（默认值起航）；数据信任边界在 PlayerPreferences.hydrate。
 */
import type { PlayerPrefsData, PreferencesPort } from "@lingfan/engine";

/** 偏好 JSON 的 localStorage 键 */
const STORAGE_KEY = "lingfan.prefs.v1";

/**
 * 造一个偏好端口（浏览器/WebView 演示兜底）：明文 JSON 存在 `lingfan.prefs.v1` 键下。
 * 没存过或存坏了都返回 null（上层用默认值起航，不因偏好损坏挡住启动）；
 * `storage` 可换成别的实现以便测试。
 */
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
        return null; // 损坏 = 无偏好（默认值起航，不影响启动）
      }
    },
    async save(data: PlayerPrefsData): Promise<void> {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
  };
}
