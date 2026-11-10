/**
 * 舞台适配编排：读一次、算一次、必要时落一次。
 *
 * 这里钉住的是编排语义而不是算式（算式在 layout 的测试里）：同样读数不重复落笔、
 * 读数不可用时不写坏数字、通知只在真落笔后发生、两个实例各管各的状态。
 * 每个用例都用「调用次数」与「收到的布局」当判据，而不是看实现里有没有某个分支。
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STAGE_CONFIG, type StagePort } from "@lingfan-engine/core";
import {
  computeStageLayout,
  createStageFitter,
  type StageLayout,
  type StageViewport,
} from "@lingfan-engine/shell";

/** 可换读数的端口替身：记下落笔，不碰任何平台对象 */
function probe(
  initial: StageViewport,
  onApply?: (layout: StageLayout) => void,
): {
  readonly port: StagePort;
  readonly applied: StageLayout[];
  setFrame(next: StageViewport): void;
} {
  let frame = initial;
  const applied: StageLayout[] = [];
  return {
    port: {
      measure: () => frame,
      apply: (layout) => {
        onApply?.(layout);
        applied.push(layout);
      },
    },
    applied,
    setFrame: (next) => {
      frame = next;
    },
  };
}

/** 落笔用到的六个数：等值判定只该看这六个 */
function geometry(layout: StageLayout): number[] {
  return [
    layout.scaleX,
    layout.scaleY,
    layout.offsetX,
    layout.offsetY,
    layout.width,
    layout.height,
  ];
}

describe("舞台适配编排", () => {
  it("缺省配置：按引擎内建基准等比适配并落笔一次", () => {
    const stage = probe({ width: 1600, height: 900 });
    const onLayout = vi.fn();
    const fitter = createStageFitter({ port: stage.port, onLayout });

    const layout = fitter.refresh();

    expect(layout).toEqual(
      computeStageLayout({ width: 1600, height: 900 }, DEFAULT_STAGE_CONFIG),
    );
    expect(stage.applied).toEqual([layout]);
    expect(onLayout).toHaveBeenCalledTimes(1);
    expect(onLayout).toHaveBeenCalledWith(layout);
    expect(fitter.layout()).toBe(layout);
  });

  it("未 refresh 过时 layout() 给缺省布局，且一次都不落笔", () => {
    const stage = probe({ width: 1600, height: 900 });
    const fitter = createStageFitter({ port: stage.port });

    const layout = fitter.layout();

    expect(layout).toEqual(
      computeStageLayout(
        {
          width: DEFAULT_STAGE_CONFIG.width,
          height: DEFAULT_STAGE_CONFIG.height,
        },
        DEFAULT_STAGE_CONFIG,
      ),
    );
    expect(layout.scaleX).toBe(1);
    expect(stage.applied).toEqual([]);
  });

  it("同样读数第二次不落笔，返回值仍是当前布局", () => {
    const stage = probe({ width: 1000, height: 1000 });
    const fitter = createStageFitter({ port: stage.port });

    const first = fitter.refresh();
    const second = fitter.refresh();

    expect(stage.applied).toHaveLength(1);
    expect(second).toBe(first);
    expect(fitter.layout()).toBe(first);
  });

  it("等值判定只看六个数：视口变了但六个落笔数值不变时不落笔", () => {
    // 原始尺寸 + 左上角对齐：偏移恒为零，落笔数值与视口无关
    const config = {
      width: 1280,
      height: 720,
      fit: "none",
      alignX: "start",
      alignY: "start",
    } as const;
    const stage = probe({ width: 1000, height: 1000 });
    const fitter = createStageFitter({ port: stage.port, config });

    const first = fitter.refresh();
    stage.setFrame({ width: 1920, height: 1080 });
    fitter.refresh();

    expect(stage.applied).toHaveLength(1);
    expect(geometry(first)).toEqual([1, 1, 0, 0, 1280, 720]);
  });

  it("读数变化导致落笔数值变化时再落一次", () => {
    const stage = probe({ width: 1000, height: 1000 });
    const fitter = createStageFitter({ port: stage.port });

    fitter.refresh();
    stage.setFrame({ width: 1600, height: 900 });
    const second = fitter.refresh();

    expect(stage.applied).toHaveLength(2);
    expect(stage.applied[1]).toBe(second);
    expect(second.scaleX).toBe(1.25);
    expect(geometry(second)).not.toEqual(geometry(stage.applied[0]!));
  });

  it("读数退化为零宽时不落笔，返回上一次的布局", () => {
    const stage = probe({ width: 1000, height: 1000 });
    const fitter = createStageFitter({ port: stage.port });
    const applied = fitter.refresh();

    stage.setFrame({ width: 0, height: 900 });
    const current = fitter.refresh();

    expect(stage.applied).toHaveLength(1);
    expect(current).toBe(applied);
    expect(fitter.layout()).toBe(applied);
  });

  it("读数非有限或为负同样不落笔（不写 NaN 进样式）", () => {
    const stage = probe({ width: 1000, height: 1000 });
    const fitter = createStageFitter({ port: stage.port });
    const applied = fitter.refresh();

    stage.setFrame({ width: Number.NaN, height: 900 });
    expect(fitter.refresh()).toBe(applied);
    stage.setFrame({ width: 1000, height: Number.POSITIVE_INFINITY });
    expect(fitter.refresh()).toBe(applied);
    stage.setFrame({ width: -1, height: 900 });
    expect(fitter.refresh()).toBe(applied);

    expect(stage.applied).toHaveLength(1);
  });

  it("首次读数就非法时给缺省布局，之后读数合法能正常落笔", () => {
    const stage = probe({ width: 0, height: 0 });
    const onLayout = vi.fn();
    const fitter = createStageFitter({ port: stage.port, onLayout });

    const fallback = fitter.refresh();
    expect(fallback).toEqual(
      computeStageLayout(
        {
          width: DEFAULT_STAGE_CONFIG.width,
          height: DEFAULT_STAGE_CONFIG.height,
        },
        DEFAULT_STAGE_CONFIG,
      ),
    );
    expect(stage.applied).toEqual([]);
    expect(onLayout).not.toHaveBeenCalled();

    stage.setFrame({ width: 1600, height: 900 });
    const layout = fitter.refresh();

    expect(stage.applied).toEqual([layout]);
    expect(layout.scaleX).toBe(1.25);
    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it("通知只在真落笔后发生：跳过与退化都不通知", () => {
    const stage = probe({ width: 1000, height: 1000 });
    const onLayout = vi.fn();
    const fitter = createStageFitter({ port: stage.port, onLayout });

    fitter.refresh();
    fitter.refresh();
    stage.setFrame({ width: 0, height: 0 });
    fitter.refresh();

    expect(onLayout).toHaveBeenCalledTimes(1);
  });

  it("夹取到同一倍率后仍按六个数等值跳过", () => {
    const config = {
      width: 1280,
      height: 720,
      fit: "contain",
      minScale: 0.5,
      alignX: "start",
      alignY: "start",
    } as const;
    const stage = probe({ width: 100, height: 100 });
    const fitter = createStageFitter({ port: stage.port, config });

    const first = fitter.refresh();
    expect(first.scaleX).toBe(0.5);
    // 未夹取时短边倍率约为 0.078：这里证明落笔用的是夹取后的值
    expect(computeStageLayout({ width: 100, height: 100 }, config).scaleX).toBe(
      0.5,
    );

    stage.setFrame({ width: 300, height: 300 });
    fitter.refresh();

    expect(stage.applied).toHaveLength(1);
  });

  it("两个实例各管各的：互不落笔、互不共享上次结果", () => {
    const left = probe({ width: 1600, height: 900 });
    const right = probe({ width: 400, height: 400 });
    const leftFitter = createStageFitter({ port: left.port });
    const rightFitter = createStageFitter({ port: right.port });

    const leftLayout = leftFitter.refresh();
    expect(right.applied).toEqual([]);
    expect(rightFitter.layout()).not.toBe(leftLayout);

    rightFitter.refresh();
    expect(left.applied).toHaveLength(1);
    expect(right.applied).toHaveLength(1);
    expect(right.applied[0]).not.toBe(leftLayout);
  });

  it("落笔抛错向上传播，且失败不污染等值判定（同读数会重试落笔）", () => {
    let budget = 1;
    const stage = probe({ width: 1600, height: 900 }, () => {
      if (budget > 0) {
        budget -= 1;
        throw new Error("apply-failed");
      }
    });
    const fitter = createStageFitter({ port: stage.port });

    expect(() => fitter.refresh()).toThrow("apply-failed");
    expect(stage.applied).toEqual([]);

    const layout = fitter.refresh();
    expect(stage.applied).toEqual([layout]);
    expect(fitter.layout()).toBe(layout);
  });
});
