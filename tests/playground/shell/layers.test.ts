import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYER_Z,
  resolveInstanceZ,
  resolveLayerZ,
} from "../../../apps/playground/src/shell/layers";

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
    expect(resolveInstanceZ("dialogue", "20" as unknown as number, table)).toBe(800);
  });
});
