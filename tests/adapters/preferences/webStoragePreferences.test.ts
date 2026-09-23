/**
 * 08 §八.2 玩家偏好持久化（localStorage 演示兜底）测试：内存 Storage 契约替身。
 * 缺失/损坏 → null（默认值起航）；数据信任边界在 PlayerPreferences.hydrate。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData } from "@lingfan/engine";
import { DEFAULT_PLAYER_PREFS } from "@lingfan/engine";
import { createWebStoragePreferencesPort } from "@lingfan/adapters";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("08 §八.2 createWebStoragePreferencesPort（localStorage 兜底）", () => {
  it("round trip：save 后 load 同值", async () => {
    const storage = new MemoryStorage();
    const port = createWebStoragePreferencesPort(storage);
    const data: PlayerPrefsData = {
      ...DEFAULT_PLAYER_PREFS,
      volumes: { ...DEFAULT_PLAYER_PREFS.volumes, bgm: 0.25 },
      textSpeed: 75,
    };
    await port.save(data);
    await expect(port.load()).resolves.toEqual(data);
  });

  it("缺失 → null（首次启动默认值起航）", async () => {
    const port = createWebStoragePreferencesPort(new MemoryStorage());
    await expect(port.load()).resolves.toBeNull();
  });

  it("损坏 JSON → null（不炸启动）", async () => {
    const storage = new MemoryStorage();
    storage.setItem("lingfan.prefs.v1", "{ not json");
    const port = createWebStoragePreferencesPort(storage);
    await expect(port.load()).resolves.toBeNull();
  });
});
