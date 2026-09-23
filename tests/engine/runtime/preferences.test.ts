/**
 * 08 §八.2 / U10 玩家偏好测试（核心层 PlayerPreferences）。
 * 锚点：
 * - effective-volume-synthesis（有效音量 = 通道偏好，静音归零；op 音量乘法在渲染层）
 * - sanitize-degrade（畸形载荷逐字段降级默认——信任边界，绝不翻译成运行时畸形值）
 * - persist-debounce-flush（防抖合并滑块连写 + dispose 补尾不丢末次修改）
 * - preferences-separate-from-save（U10：偏好不进引擎 SSOT/存档——exportSave 载荷无偏好键）
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerPrefsData } from "@lingfan/engine";
import {
  DEFAULT_PLAYER_PREFS,
  PlayerPreferences,
  SYS,
  StoryEngine,
  parseStory,
} from "@lingfan/engine";

/** PreferencesPort 契约替身：内存存储 + 调用记录 + 故障注入 */
class MemoryPrefsPort {
  readonly saves: PlayerPrefsData[] = [];
  private fail = false;

  constructor(private stored: PlayerPrefsData | null = null) {}

  failAll(): void {
    this.fail = true;
  }

  async load(): Promise<PlayerPrefsData | null> {
    if (this.fail) throw new Error("存储断路");
    return this.stored;
  }

  async save(data: PlayerPrefsData): Promise<void> {
    if (this.fail) throw new Error("存储断路");
    this.saves.push(data);
    this.stored = data;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("08 §八.2 默认值与合成末端（锚点: effective-volume-synthesis）", () => {
  it("默认偏好 = 老引擎 EnsureDefaults 基线（bgm 0.8 / se 0.6 / 文字速度 30）", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.snapshot()).toEqual(DEFAULT_PLAYER_PREFS);
    expect(prefs.effectiveVolume("bgm")).toBe(0.8);
    expect(prefs.effectiveVolume("voice")).toBe(1);
  });

  it("静音归零而非停播语义（老引擎 MasterMuted：取消静音即时恢复）", () => {
    const prefs = new PlayerPreferences();
    prefs.setMuted(true);
    for (const channel of ["bgm", "se", "ambient", "voice"] as const) {
      expect(prefs.effectiveVolume(channel)).toBe(0);
    }
    prefs.setMuted(false);
    expect(prefs.effectiveVolume("bgm")).toBe(0.8); // 即时恢复
  });

  it("音量写入钳制 0..1；畸形值忽略（fail-closed）", () => {
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", -1);
    expect(prefs.volume("bgm")).toBe(0);
    prefs.setVolume("bgm", 2);
    expect(prefs.volume("bgm")).toBe(1);
    prefs.setVolume("bgm", 0.4);
    prefs.setVolume("bgm", Number.NaN);
    prefs.setVolume("bgm", Number.POSITIVE_INFINITY);
    expect(prefs.volume("bgm")).toBe(0.4);
  });

  it("文字速度下限钳制 1；畸形值忽略", () => {
    const prefs = new PlayerPreferences();
    prefs.setTextSpeed(0);
    expect(prefs.textSpeed).toBe(1);
    prefs.setTextSpeed(45);
    prefs.setTextSpeed(Number.NaN);
    expect(prefs.textSpeed).toBe(45);
  });
});

describe("08 §八.2 观察接缝", () => {
  it("onChange 触发快照（新引用），退订后不再触发", () => {
    const prefs = new PlayerPreferences();
    const seen: PlayerPrefsData[] = [];
    const off = prefs.onChange((data) => seen.push(data));
    prefs.setVolume("se", 0.2);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.volumes.se).toBe(0.2);
    off();
    prefs.setVolume("se", 0.9);
    expect(seen).toHaveLength(1);
  });

  it("snapshot 隔离：修改返回值不污染内部状态（写时复制）", () => {
    const prefs = new PlayerPreferences();
    const snap = prefs.snapshot();
    snap.volumes.bgm = 0;
    snap.muted = true;
    expect(prefs.volume("bgm")).toBe(0.8);
    expect(prefs.muted).toBe(false);
  });
});

describe("08 §八.2 hydrate（信任边界，锚点: sanitize-degrade）", () => {
  it("合法载荷逐字段应用", async () => {
    const port = new MemoryPrefsPort({
      v: 1,
      volumes: { bgm: 0.5, se: 0.6, ambient: 0.2, voice: 0.9 },
      muted: true,
      textSpeed: 60,
    });
    const prefs = new PlayerPreferences(port);
    await prefs.hydrate();
    expect(prefs.volume("bgm")).toBe(0.5);
    expect(prefs.volume("ambient")).toBe(0.2);
    expect(prefs.muted).toBe(true);
    expect(prefs.textSpeed).toBe(60);
  });

  it("畸形载荷逐字段降级默认：坏字段回落，好字段保留", async () => {
    const port = new MemoryPrefsPort({
      v: 1,
      volumes: { bgm: "loud", se: 0.3, ambient: 99, voice: Number.NaN },
      muted: 1,
      textSpeed: "fast",
    } as unknown as PlayerPrefsData);
    const prefs = new PlayerPreferences(port);
    await prefs.hydrate();
    expect(prefs.volume("bgm")).toBe(0.8); // 非数值 → 默认
    expect(prefs.volume("se")).toBe(0.3); // 合法 → 保留
    expect(prefs.volume("ambient")).toBe(1); // 越界数值 → 钳制
    expect(prefs.muted).toBe(false); // 非布尔 → 默认
    expect(prefs.textSpeed).toBe(30); // 非数值 → 默认
  });

  it("端口载入失败 = 默认值起航（不炸启动）", async () => {
    const port = new MemoryPrefsPort();
    port.failAll();
    const prefs = new PlayerPreferences(port);
    await prefs.hydrate();
    expect(prefs.snapshot()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it("端口缺失：hydrate no-op，set 不触发持久化", () => {
    const prefs = new PlayerPreferences();
    return prefs.hydrate().then(() => {
      prefs.setVolume("bgm", 0.1); // 无端口 → 无持久化路径（不炸）
      expect(prefs.volume("bgm")).toBe(0.1);
    });
  });
});

describe("08 §八.2 持久化（锚点: persist-debounce-flush）", () => {
  it("防抖合并滑块连写为一次落盘（trailing 末值）", async () => {
    vi.useFakeTimers();
    const port = new MemoryPrefsPort();
    const prefs = new PlayerPreferences(port);
    prefs.setVolume("bgm", 0.1);
    prefs.setVolume("bgm", 0.2);
    prefs.setVolume("bgm", 0.3);
    expect(port.saves).toHaveLength(0); // 静默窗内未落盘
    await vi.advanceTimersByTimeAsync(300);
    expect(port.saves).toHaveLength(1);
    expect(port.saves[0]!.volumes.bgm).toBe(0.3);
  });

  it("dispose 补尾：防抖窗口内收尾立即落盘（不丢末次修改）", () => {
    vi.useFakeTimers();
    const port = new MemoryPrefsPort();
    const prefs = new PlayerPreferences(port);
    prefs.setTextSpeed(45);
    prefs.dispose();
    expect(port.saves).toHaveLength(1);
    expect(port.saves[0]!.textSpeed).toBe(45);
  });

  it("save 失败不炸运行时（诊断归端口/组合根）", async () => {
    vi.useFakeTimers();
    const port = new MemoryPrefsPort();
    port.failAll();
    const prefs = new PlayerPreferences(port);
    prefs.setVolume("bgm", 0.2); // 防抖后 save 被拒——不得抛出
    await vi.advanceTimersByTimeAsync(300);
    prefs.dispose(); // flush 同样被拒——不得抛出
    expect(prefs.volume("bgm")).toBe(0.2); // 运行时状态不受影响
  });
});

describe("U10 与存档分离（锚点: preferences-separate-from-save）", () => {
  it("偏好永不进引擎 SSOT/存档：exportSave 载荷无偏好键", async () => {
    const prefs = new PlayerPreferences();
    await prefs.hydrate();
    prefs.setVolume("bgm", 0.3);
    prefs.setMuted(true);
    prefs.setTextSpeed(60);
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          { id: "a", kind: "flow", commands: [{ op: "say", text: "x" }] },
        ],
      }),
    );
    engine.start(); // say 等待点 → exportSave 合法
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    const payload = JSON.stringify(data);
    expect(payload).not.toContain("__pref");
    expect(payload).not.toContain("textSpeed");
    expect(payload).not.toContain("muted");
    expect(engine.get(SYS.autoSave)).toBeUndefined(); // 引擎状态零污染旁证
  });
});
