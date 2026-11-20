/**
 * 机器级持久数据（浏览器/WebView 演示兜底）：localStorage 明文 JSON。
 * 缺失/解析失败 → null（空基线起航）；数据信任边界在 hydratePersistent。
 * 与偏好键分键存放：损坏隔离，删档不清本层（跨存档共享）。
 */
import type { PersistentData, PersistentPort } from "@lingfan-engine/core";

/** 持久数据 JSON 的 localStorage 键（与偏好键 lingfan.prefs.v1 分离） */
const STORAGE_KEY = "lingfan.persistent.v1";

/**
 * 造一个持久数据端口（浏览器/WebView 演示兜底）：明文 JSON 存在 `lingfan.persistent.v1` 键下。
 * 没存过或存坏了都返回 null（上层用空基线起航，不因持久数据损坏挡住启动）；
 * `storage` 可换成别的实现以便测试。
 */
export function createWebStoragePersistentPort(
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): PersistentPort {
  return {
    async load(): Promise<PersistentData | null> {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as PersistentData;
      } catch {
        return null; // 损坏 = 无持久数据（空基线起航，不影响启动/存档）
      }
    },
    async save(data: PersistentData): Promise<void> {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    },
  };
}
