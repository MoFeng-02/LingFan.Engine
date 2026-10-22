/**
 * 壳配置解析测试（方向默认 / 层 z 表 / 存档壳配置）。
 *
 * 解析器收进引擎 runtime（单一事实源），测试随之落在引擎域：所有宿主共用同一实现。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  DEFAULT_STAGE_CONFIG,
  LAYER_IDS,
  manifestOrientation,
  resolveInstanceZ,
  resolveLayerZ,
  resolveOrientationMode,
  resolveSavesConfig,
  resolveStageConfig,
  slotIds,
} from "@lingfan-engine/core";

describe("resolveLayerZ（层 z 表：内建默认 × 工程覆盖）", () => {
  it("无声明 → 内建默认（say/dialogue=999）", () => {
    expect(resolveLayerZ({})).toEqual(DEFAULT_LAYER_Z);
    expect(resolveLayerZ(null)).toEqual(DEFAULT_LAYER_Z);
    expect(resolveLayerZ(undefined).dialogue).toBe(999);
  });

  it("shell.layers 逐键部分覆盖", () => {
    const manifest = { shell: { layers: { video: 1200, dialogue: 900 } } };
    const table = resolveLayerZ(manifest);
    expect(table.video).toBe(1200);
    expect(table.dialogue).toBe(900);
    expect(table.choices).toBe(DEFAULT_LAYER_Z.choices); // 未覆盖键回默认
  });

  it("非法值/未知键/越界结构一律忽略（信任边界）", () => {
    const manifest = {
      shell: {
        layers: { dialogue: -1, video: "999", minigame: Number.NaN, bogus: 7 },
      },
    };
    const table = resolveLayerZ(manifest);
    expect(table.dialogue).toBe(DEFAULT_LAYER_Z.dialogue);
    expect(table.video).toBe(DEFAULT_LAYER_Z.video);
    expect(table.minigame).toBe(DEFAULT_LAYER_Z.minigame);
    expect((table as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("非对象清单结构 → 默认表", () => {
    expect(resolveLayerZ({ shell: "x" })).toEqual(DEFAULT_LAYER_Z);
    expect(resolveLayerZ({ shell: { layers: 3 } })).toEqual(DEFAULT_LAYER_Z);
  });

  it("LAYER_IDS ↔ 默认表键互锁（防清单漂移）", () => {
    expect([...LAYER_IDS].sort()).toEqual(Object.keys(DEFAULT_LAYER_Z).sort());
  });
});

describe("resolveInstanceZ（单控件实例 z：实例 > 层默认 > 内建）", () => {
  const table = resolveLayerZ({ shell: { layers: { dialogue: 800 } } });

  it("实例显式指定优先（say 2 z-index=20 → 20）", () => {
    expect(resolveInstanceZ("dialogue", 20, table)).toBe(20);
  });

  it("未指定回工程层默认", () => {
    expect(resolveInstanceZ("dialogue", undefined, table)).toBe(800);
  });

  it("无工程覆盖回内建默认", () => {
    expect(resolveInstanceZ("dialogue", undefined)).toBe(999);
    expect(resolveInstanceZ("video", undefined)).toBe(100);
  });

  it("非法实例值（负数/NaN/类型不符）回层默认", () => {
    expect(resolveInstanceZ("dialogue", -5, table)).toBe(800);
    expect(resolveInstanceZ("dialogue", Number.NaN, table)).toBe(800);
    expect(resolveInstanceZ("dialogue", "20" as unknown as number, table)).toBe(
      800,
    );
  });
});

describe("resolveSavesConfig（存档壳配置：内建默认 × 工程覆盖）", () => {
  it("无声明 → 内建默认（6 槽 / 320×180 jpeg 0.7 带文本）", () => {
    expect(resolveSavesConfig({})).toEqual(DEFAULT_SAVES_CONFIG);
    expect(resolveSavesConfig(null)).toEqual(DEFAULT_SAVES_CONFIG);
  });

  it("shell.saves 逐键覆盖（含嵌套 thumbnail）", () => {
    const config = resolveSavesConfig({
      shell: {
        saves: {
          slots: 12,
          thumbnail: { width: 480, quality: 0.9, showText: false },
        },
      },
    });
    expect(config.slots).toBe(12);
    expect(config.thumbnail.width).toBe(480);
    expect(config.thumbnail.quality).toBe(0.9);
    expect(config.thumbnail.showText).toBe(false);
    expect(config.thumbnail.height).toBe(DEFAULT_SAVES_CONFIG.thumbnail.height); // 未覆盖键回默认
  });

  it("非法值/越界一律忽略（信任边界）", () => {
    const config = resolveSavesConfig({
      shell: {
        saves: {
          slots: 0, // 越界（<1）
          thumbnail: { width: -5, height: 99999, quality: 7, showText: "yes" },
        },
      },
    });
    expect(config).toEqual(DEFAULT_SAVES_CONFIG);
  });
});

describe("resolveStageConfig（舞台适配配置：内建默认 × 工程覆盖）", () => {
  it("无声明 → 内建默认（1280 × 720 完整显示）", () => {
    expect(resolveStageConfig({})).toEqual(DEFAULT_STAGE_CONFIG);
    expect(resolveStageConfig(null)).toEqual(DEFAULT_STAGE_CONFIG);
    expect(resolveStageConfig(undefined)).toEqual(DEFAULT_STAGE_CONFIG);
  });

  it("shell.stage 逐键覆盖（基准 + 策略 + 夹取）", () => {
    const config = resolveStageConfig({
      shell: {
        stage: {
          width: 1920,
          height: 1080,
          fit: "cover",
          alignX: "start",
          minScale: 0.5,
          maxScale: 2,
        },
      },
    });
    expect(config.width).toBe(1920);
    expect(config.height).toBe(1080);
    expect(config.fit).toBe("cover");
    expect(config.alignX).toBe("start");
    expect(config.minScale).toBe(0.5);
    expect(config.maxScale).toBe(2);
    expect(config.alignY).toBeUndefined(); // 未覆盖键保持未声明（由计算件的预设锚点兜底）
  });

  it("显式 scaleBy 收名字与有限正倍率，其余忽略", () => {
    expect(
      resolveStageConfig({ shell: { stage: { scaleBy: "height" } } }).scaleBy,
    ).toBe("height");
    expect(
      resolveStageConfig({ shell: { stage: { scaleBy: 1.5 } } }).scaleBy,
    ).toBe(1.5);
    expect(
      resolveStageConfig({ shell: { stage: { scaleBy: "zoom" } } }).scaleBy,
    ).toBeUndefined();
    expect(
      resolveStageConfig({ shell: { stage: { scaleBy: 0 } } }).scaleBy,
    ).toBeUndefined();
  });

  it("非法值/越界一律忽略（信任边界）", () => {
    const config = resolveStageConfig({
      shell: {
        stage: {
          width: -5, // 越界（低于基准下限）
          height: 99999, // 越界（高于基准上限）
          fit: "zoom",
          alignX: "middle",
          alignY: 7,
          minScale: 0, // 越界（倍率下限）
          maxScale: Number.POSITIVE_INFINITY,
        },
      },
    });
    expect(config).toEqual(DEFAULT_STAGE_CONFIG);
  });

  it("minScale > maxScale：两条一起弃用（保留默认的不夹取）", () => {
    const config = resolveStageConfig({
      shell: { stage: { minScale: 4, maxScale: 2 } },
    });
    expect(config).toEqual(DEFAULT_STAGE_CONFIG);
  });

  it("只声明一条夹取时原样采纳", () => {
    expect(
      resolveStageConfig({ shell: { stage: { minScale: 0.75 } } }).minScale,
    ).toBe(0.75);
    expect(
      resolveStageConfig({ shell: { stage: { maxScale: 3 } } }).maxScale,
    ).toBe(3);
  });

  it("缺省表可换（宿主另有基准时不必改解析逻辑）", () => {
    const config = resolveStageConfig(
      { shell: { stage: { fit: "fill" } } },
      { width: 750, height: 1334 },
    );
    expect(config.width).toBe(750);
    expect(config.height).toBe(1334);
    expect(config.fit).toBe("fill");
  });
});

describe("slotIds（槽位 id 与既有存储命名兼容）", () => {
  it("slot_1..slot_N", () => {
    expect(slotIds(3)).toEqual(["slot_1", "slot_2", "slot_3"]);
    expect(slotIds(1)).toEqual(["slot_1"]);
  });
});

describe("manifestOrientation（清单信任边界）", () => {
  it("合法声明原样读出；缺段/缺字段 = undefined", () => {
    expect(manifestOrientation({ shell: { orientation: "landscape" } })).toBe(
      "landscape",
    );
    expect(manifestOrientation({ shell: {} })).toBeUndefined();
    expect(manifestOrientation({ id: "demo" })).toBeUndefined();
  });

  it("非法形状一律视为未声明（不猜测、不抛错）：异类型/坏值/非对象", () => {
    for (const bad of [
      null,
      undefined,
      "shell",
      42,
      { shell: null },
      { shell: [] },
      { shell: "landscape" },
      { shell: { orientation: "diagonal" } },
      { shell: { orientation: 90 } },
      { shell: { orientation: "Landscape" } },
    ]) {
      expect(manifestOrientation(bad)).toBeUndefined();
    }
  });
});

describe("resolveOrientationMode（优先级链）", () => {
  it("优先级：玩家偏好 > 工程默认 > auto", () => {
    expect(resolveOrientationMode("portrait", "landscape")).toBe("portrait");
    expect(resolveOrientationMode(undefined, "landscape")).toBe("landscape");
    expect(resolveOrientationMode(undefined, undefined)).toBe("auto");
  });

  it("玩家显式选 auto 覆盖作者默认（跟随系统是玩家的明确意图）", () => {
    expect(resolveOrientationMode("auto", "landscape")).toBe("auto");
  });

  it("拟态场景：作者定横屏作品，玩家未设置 → 横屏；玩家改竖屏 → 竖屏；清除偏好 → 回到横屏", () => {
    const manifest = { shell: { orientation: "landscape" as const } };
    const manifestDefault = manifestOrientation(manifest);
    expect(resolveOrientationMode(undefined, manifestDefault)).toBe(
      "landscape",
    );
    expect(resolveOrientationMode("portrait", manifestDefault)).toBe(
      "portrait",
    );
    expect(resolveOrientationMode(undefined, manifestDefault)).toBe(
      "landscape",
    );
  });
});
