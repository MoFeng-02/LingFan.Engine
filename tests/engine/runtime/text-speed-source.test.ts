/**
 * 字速归属三态契约（textSpeedSource）与三级链解析（resolveTextSpeed）。
 *
 * 判据对着「缺省 ≠ 显式」这条信任边界写：缺省（键不存在）是「玩家没说」，
 * 显式 "player"/"story" 是「玩家说过」——sanitize 绝不把缺省补成显式，
 * 否则一次 hydrate 就把「没说过」篡改成「说过」，优先级随之悄悄改变。
 * 三级链「偏好 > 故事 > 兜底」的归属由 source 声明，解析只此一处（core 零 DOM）。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData } from "@lingfan-engine/core";
import {
  DEFAULT_PLAYER_PREFS,
  PlayerPreferences,
  resolveTextSpeed,
  StoryEngine,
  parseStory,
} from "@lingfan-engine/core";

/** PreferencesPort 契约替身：内存存储（hydrate 信任边界测试用） */
class MemoryPrefsPort {
  constructor(private stored: PlayerPrefsData | null = null) {}
  async load(): Promise<PlayerPrefsData | null> {
    return this.stored;
  }
  async save(data: PlayerPrefsData): Promise<void> {
    this.stored = data;
  }
}

describe("resolveTextSpeed：三级链「偏好 > 故事 > 兜底」", () => {
  it("缺省归属（source 缺席）= 玩家偏好赢（兼容已发布存档的现行为）", () => {
    expect(resolveTextSpeed({ player: 40, story: 10, fallback: 30 })).toBe(40);
  });

  it("显式 player = 玩家偏好赢", () => {
    expect(
      resolveTextSpeed({
        player: 40,
        source: "player",
        story: 10,
        fallback: 30,
      }),
    ).toBe(40);
  });

  it("显式 story = 锁作者字速（玩家偏好不生效于当前故事）", () => {
    expect(
      resolveTextSpeed({
        player: 40,
        source: "story",
        story: 10,
        fallback: 30,
      }),
    ).toBe(10);
  });

  it("显式 story 但故事字速非法/缺席 → 落兜底（不拿玩家值顶替）", () => {
    expect(
      resolveTextSpeed({ player: 40, source: "story", fallback: 30 }),
    ).toBe(30);
    expect(
      resolveTextSpeed({ player: 40, source: "story", story: 0, fallback: 30 }),
    ).toBe(30);
    expect(
      resolveTextSpeed({
        player: 40,
        source: "story",
        story: Number.NaN,
        fallback: 30,
      }),
    ).toBe(30);
  });

  it("玩家偏好非法 → 落故事，再落兜底（逐项降级）", () => {
    expect(
      resolveTextSpeed({ player: Number.NaN, story: 10, fallback: 30 }),
    ).toBe(10);
    expect(resolveTextSpeed({ player: 0, story: 10, fallback: 30 })).toBe(10);
    expect(resolveTextSpeed({ player: Number.NaN, fallback: 30 })).toBe(30);
  });

  it("未接偏好层（player 缺席）→ 故事 > 兜底，与旧 resolveTypingCps 全同", () => {
    expect(resolveTextSpeed({ story: 10, fallback: 30 })).toBe(10);
    expect(resolveTextSpeed({ fallback: 30 })).toBe(30);
  });

  it("玩家字速下限钳制 1（合法但过小）", () => {
    expect(resolveTextSpeed({ player: 0.5, fallback: 30 })).toBe(1);
  });
});

describe("PlayerPreferences.textSpeedSource：只认两个显式值", () => {
  it("缺省键不存在（不是显式 player）", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.textSpeedSource).toBeUndefined();
    expect(prefs.snapshot()).not.toHaveProperty("textSpeedSource");
    expect(prefs.snapshot()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("set 两个合法值生效；非法值忽略（fail-closed 不抛出，状态原样）", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeedSource("story");
    expect(prefs.textSpeedSource).toBe("story");
    prefs.setTextSpeedSource("player");
    expect(prefs.textSpeedSource).toBe("player");
    prefs.setTextSpeedSource("auto" as never);
    expect(prefs.textSpeedSource).toBe("player"); // 非法忽略，保持原值
  });

  it("同值短路（不触发多余变更）", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeedSource("story");
    let changes = 0;
    prefs.onChange(() => {
      changes += 1;
    });
    prefs.setTextSpeedSource("story");
    expect(changes).toBe(0);
  });

  it("clear 回到缺省（键删除，而非写成 player）", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeedSource("story");
    prefs.clearTextSpeedSource();
    expect(prefs.textSpeedSource).toBeUndefined();
    expect(prefs.snapshot()).not.toHaveProperty("textSpeedSource");
  });

  it("snapshot 隔离：改写返回值的 source 不污染内部", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeedSource("story");
    const snap = prefs.snapshot();
    snap.textSpeedSource = "player";
    expect(prefs.textSpeedSource).toBe("story");
  });
});

describe("hydrate：textSpeedSource 信任边界（缺省 ≠ 显式）", () => {
  it("合法显式值采纳", async () => {
    const prefs = new PlayerPreferences(
      new MemoryPrefsPort({
        ...DEFAULT_PLAYER_PREFS,
        textSpeedSource: "story",
      }),
    );
    await prefs.hydrate();
    expect(prefs.textSpeedSource).toBe("story");
  });

  it("非法值忽略该键（保持缺省，不降级成 player）", async () => {
    const prefs = new PlayerPreferences(
      new MemoryPrefsPort({
        ...DEFAULT_PLAYER_PREFS,
        textSpeedSource: "auto",
      } as unknown as PlayerPrefsData),
    );
    await prefs.hydrate();
    expect(prefs.textSpeedSource).toBeUndefined();
    expect(prefs.snapshot()).not.toHaveProperty("textSpeedSource");
  });

  it("载荷无该键 → 保持缺省（sanitize 不补默认键）", async () => {
    const prefs = new PlayerPreferences(
      new MemoryPrefsPort({ ...DEFAULT_PLAYER_PREFS }),
    );
    await prefs.hydrate();
    expect(prefs.textSpeedSource).toBeUndefined();
    expect(prefs.snapshot()).not.toHaveProperty("textSpeedSource");
  });

  it("textSpeed 与 source 各自降级互不牵连", async () => {
    const prefs = new PlayerPreferences(
      new MemoryPrefsPort({
        ...DEFAULT_PLAYER_PREFS,
        textSpeed: "fast",
        textSpeedSource: "story",
      } as unknown as PlayerPrefsData),
    );
    await prefs.hydrate();
    expect(prefs.textSpeed).toBe(30); // 非法字速 → 默认
    expect(prefs.textSpeedSource).toBe("story"); // 合法归属保留
  });
});

describe("字速归属与存档分离（回溯读档跟随机器级偏好）", () => {
  it("textSpeedSource 不进存档载荷；回溯后偏好原样，字速仍按本机偏好解析", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeed(55);
    prefs.setTextSpeedSource("player");
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          {
            id: "a",
            kind: "flow",
            commands: [
              { op: "say", text: "第一句" },
              { op: "say", text: "第二句" },
            ],
          },
        ],
      }),
    );
    engine.start();
    engine.advance(); // 推进到第二句，留下可回溯的检查点

    // 存档载荷不携带字速归属（偏好是机器级的，不随存档走）
    const payload = JSON.stringify(engine.exportSave());
    expect(payload).not.toContain("textSpeedSource");
    expect(payload).not.toContain("textSpeed");

    // 回溯：引擎状态退回，偏好对象不受影响
    engine.back();
    expect(prefs.textSpeed).toBe(55);
    expect(prefs.textSpeedSource).toBe("player");
    // 字速仍按本机偏好解析，而不是被存档里的旧值覆盖
    expect(
      resolveTextSpeed({
        player: prefs.textSpeed,
        source: prefs.textSpeedSource,
        story: 10,
        fallback: 30,
      }),
    ).toBe(55);
  });
});
