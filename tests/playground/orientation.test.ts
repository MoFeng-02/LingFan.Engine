/**
 * 08 §八.2 壳配置解析（宿主侧纯函数）测试。
 * 锚点: orientation-config-resolution——优先级链「玩家偏好 > 工程默认 > auto」，
 * 以及清单信任边界（供给端口只保证取得到，形状必须自己判定）。
 */
import { describe, expect, it } from "vitest";
import {
  manifestOrientation,
  resolveOrientationMode,
} from "../../apps/playground/src/shell/orientation";

describe("08 §八.2 manifestOrientation（清单信任边界）", () => {
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

describe("08 §八.2 resolveOrientationMode（优先级链）", () => {
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
    expect(resolveOrientationMode(undefined, manifestDefault)).toBe("landscape");
    expect(resolveOrientationMode("portrait", manifestDefault)).toBe("portrait");
    expect(resolveOrientationMode(undefined, manifestDefault)).toBe("landscape");
  });
});
