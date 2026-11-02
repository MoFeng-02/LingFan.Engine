/**
 * 层级视图（`packages/ui/src/host/layer-view.ts`）的判据。
 *
 * 这个文件只做两件事：记住实例级覆盖、把「某层最终该是多少」交给注入的
 * `applyLayerZ`。所以测的也是这两件：三级链的取值顺序，以及**由 DOM 承载的层
 * 必须真的被下发**——漏一层的表现不是报错，而是那层停在 `z-index: auto`
 * 被更小的层盖住（历史面板曾因此打开也看不见）。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_Z, type LayerId } from "@lingfan-engine/core";
import { createLayerView } from "@lingfan-engine/ui";

/** 记录下发轨迹的探针 */
function probe(): {
  written: Map<LayerId, number>;
  video: number[];
  view: ReturnType<typeof createLayerView>;
} {
  const written = new Map<LayerId, number>();
  const video: number[] = [];
  const view = createLayerView({
    layerZ: DEFAULT_LAYER_Z,
    applyLayerZ: (layer, z) => {
      written.set(layer, z);
    },
    onVideoZ: (z) => {
      video.push(z);
    },
  });
  return { written, video, view };
}

describe("层级视图：下发面", () => {
  it("**由 DOM 承载的层必须全部下发**（漏一层的表现是那层被盖住，不是报错）", () => {
    const { written, view } = probe();
    view.apply();
    expect([...written.keys()].sort()).toEqual(
      [
        "choices",
        "dialogue",
        "history",
        "notifications",
        "prefs",
        "stage",
        "toolbar",
      ].sort(),
    );
  });

  it("历史与偏好两个面板层拿到的是默认表里的 1500", () => {
    const { written, view } = probe();
    view.apply();
    expect(written.get("history")).toBe(DEFAULT_LAYER_Z.history);
    expect(written.get("prefs")).toBe(DEFAULT_LAYER_Z.prefs);
    expect(written.get("history")).toBeGreaterThan(
      written.get("dialogue") ?? 0,
    );
  });

  it("视频层不混进 `apply()`，只走 `applyVideo()`", () => {
    const { written, video, view } = probe();
    view.apply();
    expect(written.has("video")).toBe(false);
    expect(video).toEqual([]);
    view.applyVideo();
    expect(video).toEqual([DEFAULT_LAYER_Z.video]);
  });
});

describe("层级视图：三级链", () => {
  it("实例覆盖 > 层默认；覆盖为 undefined 即回层默认", () => {
    const { written, view } = probe();
    view.setOverride("history", 1700);
    view.apply();
    expect(written.get("history")).toBe(1700);
    view.setOverride("history", undefined);
    view.apply();
    expect(written.get("history")).toBe(DEFAULT_LAYER_Z.history);
  });

  it("只覆盖一层不影响其它层", () => {
    const { written, view } = probe();
    view.setOverride("toolbar", 900);
    view.apply();
    expect(written.get("toolbar")).toBe(900);
    expect(written.get("prefs")).toBe(DEFAULT_LAYER_Z.prefs);
    expect(written.get("stage")).toBe(DEFAULT_LAYER_Z.stage);
  });
});
