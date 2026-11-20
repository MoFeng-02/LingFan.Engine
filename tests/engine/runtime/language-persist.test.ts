/**
 * 语言偏好的机器级持久化语义（存档语言赢 + 偏好会话种子 + 切换记住）。
 *
 * 这里锁的是**偏好契约层**的三件事（宿主接线另在各宿主装配处）：
 * - 会话种子：新会话没有存档语言时，玩家偏好语言作种子（resolveLanguage 玩家档）。
 * - 切换记住：玩家切语言写进偏好快照，水合回来仍在（机器级，不随存档）。
 * - 存档赢：读档时存档语言压过偏好种子（故事事实优先）。
 *
 * 偏好与存档分离：语言偏好走 PreferencesPort（系统配置），不进存档载荷。
 */
import { describe, expect, it } from "vitest";
import {
  PlayerPreferences,
  resolveLanguage,
  type PreferencesPort,
  type PlayerPrefsData,
} from "@lingfan-engine/core";

/** 内存偏好端口替身：load/save 一份快照 */
class MemoryPrefsPort implements PreferencesPort {
  private data: PlayerPrefsData | null = null;
  async load(): Promise<PlayerPrefsData | null> {
    return this.data;
  }
  async save(data: PlayerPrefsData): Promise<void> {
    this.data = data;
  }
}

describe("会话种子（新会话无存档语言）", () => {
  it("玩家偏好语言作种子", () => {
    expect(resolveLanguage({ player: "ja" })).toBe("ja");
  });

  it("偏好缺席 → 工程默认兜底", () => {
    expect(resolveLanguage({ manifest: "en" })).toBe("en");
  });

  it("都缺席 → undefined（跟随原文）", () => {
    expect(resolveLanguage({})).toBeUndefined();
  });
});

describe("切换记住（机器级，水合往返）", () => {
  it("切语言写偏好 → 快照带 language → 新实例水合仍在", async () => {
    const port = new MemoryPrefsPort();
    const prefs = new PlayerPreferences(port);
    prefs.setLanguage("ja");
    expect(prefs.snapshot().language).toBe("ja");
    await port.save(prefs.snapshot());

    // 重启：新实例从端口水合，语言 remembered
    const restarted = new PlayerPreferences(port);
    await restarted.hydrate();
    expect(restarted.language).toBe("ja");
  });

  it("clearLanguage 回未设置（跟随工程/存档），快照不带键", () => {
    const prefs = new PlayerPreferences();
    prefs.setLanguage("ja");
    prefs.clearLanguage();
    expect(prefs.language).toBeUndefined();
    expect(prefs.snapshot().language).toBeUndefined();
  });

  it("非法语言写入被拒（fail-closed，状态原样）", () => {
    const prefs = new PlayerPreferences();
    prefs.setLanguage("ja");
    prefs.setLanguage("");
    expect(prefs.language).toBe("ja");
  });
});

describe("存档语言赢（读档压过偏好种子）", () => {
  it("存档语言 > 玩家种子 > 工程默认", () => {
    expect(resolveLanguage({ save: "en", player: "ja", manifest: "fr" })).toBe(
      "en",
    );
  });

  it("存档缺席才轮到玩家种子", () => {
    expect(resolveLanguage({ player: "ja", manifest: "fr" })).toBe("ja");
  });
});
