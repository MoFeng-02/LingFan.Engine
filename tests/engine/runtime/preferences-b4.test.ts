/**
 * 运行时配置契约（玩家偏好扩展字段）测试。
 *
 * 覆盖五类：
 * - 多方位：19 个新字段的信任边界校验（合法才写、非法丢弃、缺省不补默认键）。
 * - 拟态用户旅程：hydrate 一份「玩家调过一半」的载荷 → 读快照 → 改设置 → 再读。
 * - 故意错误 fail-closed：畸形载荷逐字段降级，状态不半恢复、不抛 TypeError。
 * - 不变量混沌：随机游走 setter，快照值域/三态语义恒成立。
 * - 边界条件：值域端点、窗口尺寸整体采纳/整体丢弃、语言/字体限长。
 *
 * 核心纪律「缺省 ≠ 显式」：可选键缺席 = 跟随（系统/作者/内建），校验绝不补默认键。
 */
import { describe, expect, it } from "vitest";
import type { ElementFit, PlayerPrefsData } from "@lingfan-engine/core";
import {
  AUTO_DELAY_MS_RANGE,
  DEFAULT_PLAYER_PREFS,
  DIALOGUE_HEIGHT_SCALE_RANGE,
  FONT_FAMILY_MAX,
  FONT_SCALE_RANGE,
  LANGUAGE_MAX,
  NVL_PAGE_SIZE_RANGE,
  PlayerPreferences,
  SKIP_DELAY_MS_RANGE,
  TRANSITION_SPEED_RANGE,
  WINDOW_HEIGHT_RANGE,
  WINDOW_WIDTH_RANGE,
  resolveLanguage,
  resolveReducedMotion,
} from "@lingfan-engine/core";

/** PreferencesPort 契约替身：内存存储，hydrate 时交出预置载荷 */
class MemoryPrefsPort {
  constructor(private stored: PlayerPrefsData | null = null) {}
  async load(): Promise<PlayerPrefsData | null> {
    return this.stored;
  }
  async save(): Promise<void> {}
}

/** 用一份原始载荷水合偏好层，返回快照（信任边界经 hydrate→sanitize） */
async function hydrate(raw: unknown): Promise<PlayerPrefsData> {
  const prefs = new PlayerPreferences(
    new MemoryPrefsPort(raw as PlayerPrefsData),
  );
  await prefs.hydrate();
  return prefs.snapshot();
}

describe("信任边界：可选键仅合法才写，缺省不补默认键", () => {
  it("空载荷只含基础键，19 个新字段一个都不补", async () => {
    const snap = await hydrate({});
    expect(snap.v).toBe(1);
    expect(snap.volumes).toEqual(DEFAULT_PLAYER_PREFS.volumes);
    expect(snap.muted).toBe(DEFAULT_PLAYER_PREFS.muted);
    expect(snap.textSpeed).toBe(DEFAULT_PLAYER_PREFS.textSpeed);
    for (const key of [
      "masterVolume",
      "instantText",
      "autoDelayMs",
      "autoEnabled",
      "skipDelayMs",
      "skipUnseenOnly",
      "typeSound",
      "transitionSpeed",
      "shakeScale",
      "reducedMotion",
      "fontScale",
      "dialogueOpacity",
      "dialoguePosition",
      "dialogueHeightScale",
      "fontFamily",
      "nvlPageSize",
      "elementFit",
      "windowSize",
      "language",
    ] as const) {
      expect(key in snap).toBe(false);
    }
  });

  it("合法数值倍率采纳并钳到值域端点", async () => {
    const snap = await hydrate({
      masterVolume: 0.5,
      transitionSpeed: TRANSITION_SPEED_RANGE.max + 100,
      shakeScale: -3,
      fontScale: FONT_SCALE_RANGE.min,
      dialogueOpacity: 0.25,
      dialogueHeightScale: DIALOGUE_HEIGHT_SCALE_RANGE.max + 5,
      nvlPageSize: NVL_PAGE_SIZE_RANGE.max + 50,
    });
    expect(snap.masterVolume).toBe(0.5);
    expect(snap.transitionSpeed).toBe(TRANSITION_SPEED_RANGE.max);
    expect(snap.shakeScale).toBe(0);
    expect(snap.fontScale).toBe(FONT_SCALE_RANGE.min);
    expect(snap.dialogueOpacity).toBe(0.25);
    expect(snap.dialogueHeightScale).toBe(DIALOGUE_HEIGHT_SCALE_RANGE.max);
    expect(snap.nvlPageSize).toBe(NVL_PAGE_SIZE_RANGE.max);
  });

  it("非法数值丢弃该键（不补默认）：NaN/Infinity/字符串/小数计数", async () => {
    const snap = await hydrate({
      masterVolume: Number.NaN,
      transitionSpeed: Number.POSITIVE_INFINITY,
      shakeScale: "0.5",
      fontScale: null,
      nvlPageSize: 3.5,
      autoDelayMs: 1.5,
      skipDelayMs: 2.2,
    });
    for (const key of [
      "masterVolume",
      "transitionSpeed",
      "shakeScale",
      "fontScale",
      "nvlPageSize",
      "autoDelayMs",
      "skipDelayMs",
    ] as const) {
      expect(key in snap).toBe(false);
    }
  });

  it("布尔开关仅真布尔采纳；0/1/字符串丢弃", async () => {
    const ok = await hydrate({
      instantText: true,
      autoEnabled: false,
      skipUnseenOnly: true,
      typeSound: false,
      reducedMotion: true,
    });
    expect(ok.instantText).toBe(true);
    expect(ok.autoEnabled).toBe(false);
    expect(ok.skipUnseenOnly).toBe(true);
    expect(ok.typeSound).toBe(false);
    expect(ok.reducedMotion).toBe(true);

    const bad = await hydrate({
      instantText: 1,
      autoEnabled: "true",
      typeSound: 0,
      reducedMotion: null,
    });
    for (const key of [
      "instantText",
      "autoEnabled",
      "typeSound",
      "reducedMotion",
    ] as const) {
      expect(key in bad).toBe(false);
    }
  });

  it("闭合词表：dialoguePosition/elementFit 成员才采纳", async () => {
    const ok = await hydrate({
      dialoguePosition: "top",
      elementFit: "contain",
    });
    expect(ok.dialoguePosition).toBe("top");
    expect(ok.elementFit).toBe("contain");

    const bad = await hydrate({
      dialoguePosition: "middle",
      elementFit: "stretch",
    });
    expect("dialoguePosition" in bad).toBe(false);
    expect("elementFit" in bad).toBe(false);
  });

  it("窗口尺寸：宽高均合法才整体采纳，任一非法整体丢弃", async () => {
    const ok = await hydrate({
      windowSize: {
        width: WINDOW_WIDTH_RANGE.min,
        height: WINDOW_HEIGHT_RANGE.max,
      },
    });
    expect(ok.windowSize).toEqual({
      width: WINDOW_WIDTH_RANGE.min,
      height: WINDOW_HEIGHT_RANGE.max,
    });

    for (const bad of [
      { width: WINDOW_WIDTH_RANGE.min - 1, height: 600 },
      { width: 800, height: WINDOW_HEIGHT_RANGE.max + 1 },
      { width: 800.5, height: 600 },
      { width: 800 },
      { width: "800", height: 600 },
      null,
      42,
    ]) {
      const snap = await hydrate({ windowSize: bad });
      expect("windowSize" in snap).toBe(false);
    }
  });

  it("语言/字体：非空字符串限长采纳，空串/超长/非字符串丢弃", async () => {
    const ok = await hydrate({ language: "zh-CN", fontFamily: "Noto Serif" });
    expect(ok.language).toBe("zh-CN");
    expect(ok.fontFamily).toBe("Noto Serif");

    const bad = await hydrate({
      language: "",
      fontFamily: "x".repeat(FONT_FAMILY_MAX + 1),
    });
    expect("language" in bad).toBe(false);
    expect("fontFamily" in bad).toBe(false);

    const tooLong = await hydrate({ language: "x".repeat(LANGUAGE_MAX + 1) });
    expect("language" in tooLong).toBe(false);
  });

  it("自动/快进停留时长：非负整数钳到上限", async () => {
    const snap = await hydrate({
      autoDelayMs: AUTO_DELAY_MS_RANGE.max + 1000,
      skipDelayMs: SKIP_DELAY_MS_RANGE.min,
    });
    expect(snap.autoDelayMs).toBe(AUTO_DELAY_MS_RANGE.max);
    expect(snap.skipDelayMs).toBe(SKIP_DELAY_MS_RANGE.min);
  });
});

describe("拟态用户旅程：调一半的载荷水合 → 改设置 → 再读", () => {
  it("水合保留玩家已调字段，未调字段仍跟随缺省", async () => {
    const prefs = new PlayerPreferences(
      new MemoryPrefsPort({
        v: 1,
        volumes: { ...DEFAULT_PLAYER_PREFS.volumes },
        muted: false,
        textSpeed: 30,
        masterVolume: 0.7,
        fontScale: 1.2,
      } as PlayerPrefsData),
    );
    await prefs.hydrate();
    expect(prefs.masterVolume).toBe(0.7);
    expect(prefs.fontScale).toBe(1.2);
    // 未调字段：三态 getter 返 undefined（跟随），数值 getter 解析内建默认
    expect(prefs.elementFit).toBeUndefined();
    expect(prefs.transitionSpeed).toBe(1);
    expect(prefs.instantText).toBe(false);

    prefs.setMasterVolume(0.4);
    prefs.setElementFit("fill");
    expect(prefs.masterVolume).toBe(0.4);
    expect(prefs.elementFit).toBe("fill");
    // 改一个字段不影响其它已调字段
    expect(prefs.fontScale).toBe(1.2);
  });
});

describe("优先级链解析（纯函数）", () => {
  it("减弱动效：玩家显式 > 系统 > 内建 false", () => {
    expect(resolveReducedMotion({ player: true, system: false })).toBe(true);
    expect(resolveReducedMotion({ player: false, system: true })).toBe(false);
    expect(resolveReducedMotion({ system: true })).toBe(true);
    expect(resolveReducedMotion({ system: false })).toBe(false);
    expect(resolveReducedMotion({})).toBe(false);
  });

  it("语言：存档赢 > 玩家种子 > 工程默认；都缺席 undefined", () => {
    expect(resolveLanguage({ save: "en", player: "zh", manifest: "ja" })).toBe(
      "en",
    );
    expect(resolveLanguage({ player: "zh", manifest: "ja" })).toBe("zh");
    expect(resolveLanguage({ manifest: "ja" })).toBe("ja");
    expect(resolveLanguage({})).toBeUndefined();
    // 存档语言为空串时仍按「缺席」落到下一层（?? 语义）
    expect(resolveLanguage({ save: "", player: "zh" })).toBe("");
  });
});

describe("主音量合成末端", () => {
  it("effectiveVolume = 通道音量 × 主音量；静音归零", () => {
    const prefs = new PlayerPreferences();
    prefs.setVolume("bgm", 0.8);
    prefs.setMasterVolume(0.5);
    expect(prefs.effectiveVolume("bgm")).toBeCloseTo(0.4, 6);
    prefs.setMuted(true);
    expect(prefs.effectiveVolume("bgm")).toBe(0);
    prefs.setMuted(false);
    expect(prefs.effectiveVolume("bgm")).toBeCloseTo(0.4, 6);
  });

  it("主音量缺省 = 1（不改变既有通道音量行为）", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.masterVolume).toBe(1);
    expect(prefs.effectiveVolume("bgm")).toBe(0.8);
  });

  it("主音量写入钳制 0..1，非有限数忽略（fail-closed）", () => {
    const prefs = new PlayerPreferences();
    prefs.setMasterVolume(2);
    expect(prefs.masterVolume).toBe(1);
    prefs.setMasterVolume(-1);
    expect(prefs.masterVolume).toBe(0);
    prefs.setMasterVolume(0.6);
    prefs.setMasterVolume(Number.NaN);
    expect(prefs.masterVolume).toBe(0.6);
  });
});

describe("三态字段 setter/clear 与 getter 默认", () => {
  it("数值倍率 getter 缺省解析内建默认，setter 钳制", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.transitionSpeed).toBe(1);
    expect(prefs.shakeScale).toBe(1);
    expect(prefs.fontScale).toBe(1);
    prefs.setTransitionSpeed(TRANSITION_SPEED_RANGE.max + 1);
    expect(prefs.transitionSpeed).toBe(TRANSITION_SPEED_RANGE.max);
    prefs.setShakeScale(-0.5);
    expect(prefs.shakeScale).toBe(0);
    prefs.setFontScale(FONT_SCALE_RANGE.min - 1);
    expect(prefs.fontScale).toBe(FONT_SCALE_RANGE.min);
  });

  it("三态 getter 缺省 undefined；set 后显式；clear 回到跟随", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.reducedMotion).toBeUndefined();
    expect(prefs.dialogueOpacity).toBeUndefined();
    expect(prefs.dialoguePosition).toBeUndefined();
    expect(prefs.dialogueHeightScale).toBeUndefined();
    expect(prefs.nvlPageSize).toBeUndefined();
    expect(prefs.elementFit).toBeUndefined();
    expect(prefs.language).toBeUndefined();

    prefs.setReducedMotion(true);
    prefs.setDialogueOpacity(0.5);
    prefs.setDialoguePosition("center");
    prefs.setDialogueHeightScale(1.5);
    prefs.setNvlPageSize(10);
    prefs.setElementFit("cover");
    prefs.setLanguage("en");
    expect(prefs.reducedMotion).toBe(true);
    expect(prefs.dialogueOpacity).toBe(0.5);
    expect(prefs.dialoguePosition).toBe("center");
    expect(prefs.dialogueHeightScale).toBe(1.5);
    expect(prefs.nvlPageSize).toBe(10);
    expect(prefs.elementFit).toBe("cover");
    expect(prefs.language).toBe("en");

    prefs.clearReducedMotion();
    prefs.clearDialogueOpacity();
    prefs.clearDialoguePosition();
    prefs.clearDialogueHeightScale();
    prefs.clearNvlPageSize();
    prefs.clearElementFit();
    prefs.clearLanguage();
    expect(prefs.reducedMotion).toBeUndefined();
    expect(prefs.dialogueOpacity).toBeUndefined();
    expect(prefs.dialoguePosition).toBeUndefined();
    expect(prefs.dialogueHeightScale).toBeUndefined();
    expect(prefs.nvlPageSize).toBeUndefined();
    expect(prefs.elementFit).toBeUndefined();
    expect(prefs.language).toBeUndefined();
    // clear 后快照里这些键必须消失（缺省 ≠ 显式）
    const snap = prefs.snapshot();
    for (const key of [
      "reducedMotion",
      "dialogueOpacity",
      "dialoguePosition",
      "dialogueHeightScale",
      "nvlPageSize",
      "elementFit",
      "language",
    ] as const) {
      expect(key in snap).toBe(false);
    }
  });

  it("即时文本布尔开关：缺省 false，set 生效", () => {
    const prefs = new PlayerPreferences();
    expect(prefs.instantText).toBe(false);
    prefs.setInstantText(true);
    expect(prefs.instantText).toBe(true);
    prefs.setInstantText(false);
    expect(prefs.instantText).toBe(false);
  });
});

describe("不变量混沌：随机游走 setter，值域/三态恒成立", () => {
  it("200 步随机写入后快照字段始终合法", () => {
    const prefs = new PlayerPreferences();
    // 确定性伪随机（线性同余），避免测试抖动
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T>(arr: readonly T[]): T =>
      arr[Math.floor(rand() * arr.length)] as T;

    for (let i = 0; i < 200; i += 1) {
      const action = Math.floor(rand() * 8);
      const weird = pick([rand() * 4 - 2, Number.NaN, -5, 999]);
      switch (action) {
        case 0:
          prefs.setMasterVolume(weird);
          break;
        case 1:
          prefs.setTransitionSpeed(weird);
          break;
        case 2:
          prefs.setShakeScale(weird);
          break;
        case 3:
          prefs.setFontScale(weird);
          break;
        case 4:
          prefs.setDialogueOpacity(weird);
          break;
        case 5:
          prefs.setNvlPageSize(Math.round(weird));
          break;
        case 6:
          // 混沌游走故意混入词表外的 "bogus"：setter 运行时须忽略非法值（fail-closed），
          // 类型上强转才能把域外值喂进签名受 ElementFit 约束的 setter。
          prefs.setElementFit(
            pick(["cover", "contain", "bogus"]) as ElementFit,
          );
          break;
        default:
          prefs.setReducedMotion(rand() > 0.5);
      }
      const snap = prefs.snapshot();
      expect(snap.v).toBe(1);
      if (snap.masterVolume !== undefined) {
        expect(snap.masterVolume).toBeGreaterThanOrEqual(0);
        expect(snap.masterVolume).toBeLessThanOrEqual(1);
      }
      if (snap.transitionSpeed !== undefined) {
        expect(snap.transitionSpeed).toBeGreaterThanOrEqual(
          TRANSITION_SPEED_RANGE.min,
        );
        expect(snap.transitionSpeed).toBeLessThanOrEqual(
          TRANSITION_SPEED_RANGE.max,
        );
      }
      if (snap.shakeScale !== undefined) {
        expect(snap.shakeScale).toBeGreaterThanOrEqual(0);
        expect(snap.shakeScale).toBeLessThanOrEqual(1);
      }
      if (snap.fontScale !== undefined) {
        expect(snap.fontScale).toBeGreaterThanOrEqual(FONT_SCALE_RANGE.min);
        expect(snap.fontScale).toBeLessThanOrEqual(FONT_SCALE_RANGE.max);
      }
      if (snap.dialogueOpacity !== undefined) {
        expect(snap.dialogueOpacity).toBeGreaterThanOrEqual(0);
        expect(snap.dialogueOpacity).toBeLessThanOrEqual(1);
      }
      if (snap.nvlPageSize !== undefined) {
        expect(Number.isInteger(snap.nvlPageSize)).toBe(true);
        expect(snap.nvlPageSize).toBeGreaterThanOrEqual(
          NVL_PAGE_SIZE_RANGE.min,
        );
        expect(snap.nvlPageSize).toBeLessThanOrEqual(NVL_PAGE_SIZE_RANGE.max);
      }
      if (snap.elementFit !== undefined) {
        expect(["fill", "contain", "cover", "none", "scale-down"]).toContain(
          snap.elementFit,
        );
      }
    }
  });
});
