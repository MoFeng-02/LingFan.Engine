import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVES_CONFIG,
  resolveSavesConfig,
  slotIds,
} from "../../../apps/playground/src/shell/saves";

describe("resolveSavesConfig（存档壳配置：内建默认 × 工程覆盖）", () => {
  it("无声明 → 内建默认（6 槽 / 320×180 jpeg 0.7 带文本）", () => {
    expect(resolveSavesConfig({})).toEqual(DEFAULT_SAVES_CONFIG);
    expect(resolveSavesConfig(null)).toEqual(DEFAULT_SAVES_CONFIG);
  });

  it("shell.saves 逐键覆盖（含嵌套 thumbnail）", () => {
    const config = resolveSavesConfig({
      shell: { saves: { slots: 12, thumbnail: { width: 480, quality: 0.9, showText: false } } },
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

describe("slotIds（槽位 id 与既有存储命名兼容）", () => {
  it("slot_1..slot_N", () => {
    expect(slotIds(3)).toEqual(["slot_1", "slot_2", "slot_3"]);
    expect(slotIds(1)).toEqual(["slot_1"]);
  });
});
