/**
 * 舞台适配计算：设计基准 + 策略 → 缩放与偏移，视口尺寸由宿主喂进来。
 *
 * 舞台原先等于视口，作者写的像素就是屏幕像素，窗口一变内容尺寸不变。这里钉住的是
 * 适配口径本身：基准尺寸、等比/裁切/拉伸/原始尺寸四种预设、以及锚点与缩放夹取，
 * 都走同一条纯计算路径；预设与自定义是同一组参数的两种写法，不能用两套实现。
 *
 * 同时用源级断言锁住「本域不读平台全局」：视口尺寸必须由宿主传入，否则小程序宿主
 * 与桌面宿主只能各抄一份算法。
 */
import { describe, expect, it } from "vitest";
import {
  computeStageLayout,
  DEFAULT_STAGE_FIT,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  resolveStagePreset,
  stageTransform,
  STAGE_BASELINES,
  STAGE_PRESETS,
  type StageConfig,
} from "../../../packages/shell/src/stage";

/** 本域源码（源级断言用）：只该做纯计算 */
const SOURCE = import.meta.glob("../../../packages/shell/src/stage/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 1280 × 720 基准 */
const BASE: StageConfig = { width: 1280, height: 720 };

describe("舞台适配计算", () => {
  it("缺省完整显示：短边铺满并把余量居中", () => {
    const layout = computeStageLayout({ width: 1000, height: 1000 }, BASE);
    expect(layout.policy).toBe("min");
    expect(layout.scaleX).toBeCloseTo(0.78125, 6);
    expect(layout.scaleY).toBeCloseTo(0.78125, 6);
    expect(layout.scaledWidth).toBeCloseTo(1000, 6);
    expect(layout.scaledHeight).toBeCloseTo(562.5, 6);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeCloseTo(218.75, 6);
  });

  it("基准与视口同比例时没有余量，缩放即窗口比例", () => {
    const layout = computeStageLayout({ width: 1600, height: 900 }, BASE);
    expect(layout.scaleX).toBeCloseTo(1.25, 6);
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeCloseTo(0, 6);
  });

  it("铺满裁切：长边对齐，溢出方向偏移为负", () => {
    const layout = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, fit: "cover" },
    );
    expect(layout.policy).toBe("max");
    expect(layout.scaleX).toBeCloseTo(1.388889, 5);
    expect(layout.scaledHeight).toBeCloseTo(1000, 5);
    expect(layout.scaledWidth).toBeCloseTo(1777.778, 3);
    expect(layout.offsetY).toBeCloseTo(0, 5);
    expect(layout.offsetX).toBeCloseTo(-388.889, 3);
  });

  it("拉伸铺满：两轴各自拉满，允许不等比", () => {
    const layout = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, fit: "fill" },
    );
    expect(layout.policy).toBe("fill");
    expect(layout.scaleX).toBeCloseTo(0.78125, 6);
    expect(layout.scaleY).toBeCloseTo(1.388889, 5);
    expect(layout.scaledWidth).toBeCloseTo(1000, 5);
    expect(layout.scaledHeight).toBeCloseTo(1000, 5);
  });

  it("原始尺寸：不缩放，只按锚点居中", () => {
    const layout = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, fit: "none" },
    );
    expect(layout.scaleX).toBe(1);
    expect(layout.scaleY).toBe(1);
    expect(layout.offsetX).toBeCloseTo(-140, 6);
    expect(layout.offsetY).toBeCloseTo(140, 6);
  });

  it("显式策略覆盖预设：单轴对齐时另一轴留边", () => {
    const layout = computeStageLayout(
      { width: 1600, height: 900 },
      { ...BASE, scaleBy: "width" },
    );
    expect(layout.scaleX).toBeCloseTo(1.25, 6);
    expect(layout.scaleY).toBeCloseTo(1.25, 6);
    expect(layout.offsetY).toBeCloseTo(0, 6);
  });

  it("显式锚点覆盖预设：余量按锚点分给两侧", () => {
    const layout = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, alignX: "start", alignY: "end" },
    );
    expect(layout.offsetX).toBeCloseTo(0, 6);
    expect(layout.offsetY).toBeCloseTo(437.5, 6);
  });

  it("缩放夹取按轴生效，且不破坏等比", () => {
    const tiny = computeStageLayout(
      { width: 100, height: 100 },
      { ...BASE, minScale: 0.5 },
    );
    expect(tiny.scaleX).toBe(0.5);
    expect(tiny.scaleY).toBe(0.5);
    const huge = computeStageLayout(
      { width: 5000, height: 5000 },
      { ...BASE, maxScale: 2 },
    );
    expect(huge.scaleX).toBe(2);
    expect(huge.scaleY).toBe(2);
  });

  it("固定倍率策略：数字即倍率，非法数字退回 1", () => {
    const fixed = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, scaleBy: 2.5 },
    );
    expect(fixed.scaleX).toBe(2.5);
    expect(fixed.scaledWidth).toBeCloseTo(3200, 6);
    const broken = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, scaleBy: -3 },
    );
    expect(broken.scaleX).toBe(1);
  });

  it("尺寸不可用时退化为原始尺寸左上角，不产出 NaN", () => {
    const zeroViewport = computeStageLayout({ width: 0, height: 0 }, BASE);
    expect(zeroViewport.scaleX).toBe(1);
    expect(zeroViewport.scaledWidth).toBe(1280);
    expect(zeroViewport.offsetX).toBe(0);
    const badBaseline = computeStageLayout(
      { width: 1000, height: 1000 },
      { width: Number.NaN, height: -1 },
    );
    expect(badBaseline.width).toBe(0);
    expect(badBaseline.scaleX).toBe(1);
    expect(Number.isNaN(badBaseline.scaledWidth)).toBe(false);
  });

  it("预设就是参数组合：四种预设都可被显式参数原样复现", () => {
    const viewport = { width: 1440, height: 900 };
    for (const preset of Object.values(STAGE_PRESETS)) {
      const byPreset = computeStageLayout(viewport, {
        ...BASE,
        fit: preset.fit,
      });
      const byParams = computeStageLayout(viewport, {
        ...BASE,
        scaleBy: preset.scaleBy,
        alignX: preset.alignX,
        alignY: preset.alignY,
      });
      expect(byPreset).toEqual(byParams);
      expect(byPreset.policy).toBe(preset.scaleBy);
      expect(resolveStagePreset(preset.fit).label).toBe(preset.label);
    }
  });

  it("策略表与基准表自身自洽，未知策略名回退缺省", () => {
    expect(resolveStagePreset(undefined).fit).toBe(DEFAULT_STAGE_FIT);
    expect(resolveStagePreset("unknown" as never).fit).toBe(DEFAULT_STAGE_FIT);
    for (const [key, preset] of Object.entries(STAGE_PRESETS)) {
      expect(preset.fit).toBe(key);
      expect(preset.label.length).toBeGreaterThan(0);
    }
    const ids = STAGE_BASELINES.map((baseline) => baseline.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const baseline of STAGE_BASELINES) {
      expect(baseline.width).toBeGreaterThan(0);
      expect(baseline.height).toBeGreaterThan(0);
      expect(baseline.label.length).toBeGreaterThan(0);
    }
    expect(
      STAGE_BASELINES.some(
        (baseline) =>
          baseline.width === DEFAULT_STAGE_WIDTH &&
          baseline.height === DEFAULT_STAGE_HEIGHT,
      ),
    ).toBe(true);
  });

  it("任意自定义基准尺寸都被吃得下（不必在预设表里）", () => {
    const layout = computeStageLayout(
      { width: 600, height: 600 },
      { width: 640, height: 360 },
    );
    expect(layout.scaleX).toBeCloseTo(600 / 640, 6);
    expect(layout.scaledHeight).toBeCloseTo(337.5, 6);
    expect(layout.offsetY).toBeCloseTo(131.25, 6);
  });

  it("变换串：先平移再缩放，宿主两端共用同一份写法", () => {
    const contained = computeStageLayout({ width: 1000, height: 1000 }, BASE);
    expect(stageTransform(contained)).toBe(
      "translate(0px, 218.75px) scale(0.78125, 0.78125)",
    );
    const covering = computeStageLayout(
      { width: 1000, height: 1000 },
      { ...BASE, fit: "cover" },
    );
    expect(stageTransform(covering)).toBe(
      "translate(-388.888889px, 0px) scale(1.388889, 1.388889)",
    );
  });

  it("变换串对非法数字兜底：NaN 会让 CSS 整条声明被丢弃", () => {
    const degenerate = computeStageLayout(
      { width: 0, height: 0 },
      { width: Number.NaN, height: 0 },
    );
    expect(stageTransform(degenerate)).toBe("translate(0px, 0px) scale(1, 1)");
    expect(
      stageTransform({
        ...degenerate,
        offsetX: Number.NaN,
        scaleX: Number.POSITIVE_INFINITY,
      }),
    ).toBe("translate(0px, 0px) scale(0, 1)");
  });

  it("源级：本域不读平台全局与视口，视口尺寸只经入参进来", () => {
    const sources = Object.values(SOURCE);
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const source of sources) {
      expect(source).not.toMatch(
        /\bdocument\b|\bwindow\b|innerWidth|innerHeight|ResizeObserver|devicePixelRatio/,
      );
    }
    const layout = SOURCE["../../../packages/shell/src/stage/layout.ts"] ?? "";
    expect(layout).toMatch(/config\.scaleBy \?\? preset\.scaleBy/);
    expect(layout).toMatch(/config\.alignX \?\? preset\.alignX/);
  });
});
