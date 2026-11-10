/**
 * 舞台适配的 CSS 宿主端口：两个动作接到样式写入面上。
 *
 * 判据是「写了什么、按什么顺序写、没东西可写时是否一个字都不写」——端口自己不重算，
 * 所以数值必须与 `stageTransform` 的派生结果逐字一致；顺序错会让偏移量被再缩放一遍，
 * 这里用写入轨迹把顺序也钉住。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE_CONFIG } from "@lingfan-engine/core";
import {
  computeStageLayout,
  createStagePort,
  stageTransform,
  type StageStyleTarget,
} from "@lingfan-engine/shell";

/** 假舞台根：记下每次样式写入的属性名与值（测试环境没有真实节点） */
function fakeRoot(): {
  readonly target: StageStyleTarget;
  readonly writes: Array<{ readonly name: string; readonly value: string }>;
} {
  const writes: Array<{ readonly name: string; readonly value: string }> = [];
  const current: Record<string, string> = {};
  const style = {} as StageStyleTarget["style"];
  const target = { style } as StageStyleTarget;
  const writable = style as Record<string, string>;
  const tracked = ["width", "height", "transformOrigin", "transform"];
  for (const name of tracked) {
    Object.defineProperty(writable, name, {
      get: () => current[name] ?? "",
      set: (value: string) => {
        current[name] = value;
        writes.push({ name, value });
      },
      configurable: true,
    });
  }
  return { target, writes };
}

describe("createStagePort（CSS 宿主端口）", () => {
  it("落布局写四个属性：宽、高、变换原点、变换", () => {
    const root = fakeRoot();
    const port = createStagePort({
      readRoot: () => root.target,
      readFrame: () => ({ width: 1600, height: 900 }),
    });
    const layout = computeStageLayout(
      { width: 1600, height: 900 },
      DEFAULT_STAGE_CONFIG,
    );

    port.apply(layout);

    expect(root.target.style.width).toBe(`${layout.width}px`);
    expect(root.target.style.height).toBe(`${layout.height}px`);
    expect(root.target.style.transformOrigin).toBe("0 0");
    expect(root.target.style.transform).toBe(stageTransform(layout));
  });

  it("变换原点先于变换写入：原点留在中心会把偏移量再缩放一遍", () => {
    const root = fakeRoot();
    const port = createStagePort({
      readRoot: () => root.target,
      readFrame: () => ({ width: 1000, height: 1000 }),
    });

    port.apply(
      computeStageLayout({ width: 1000, height: 1000 }, DEFAULT_STAGE_CONFIG),
    );

    const names = root.writes.map((write) => write.name);
    expect(names.indexOf("width")).toBeLessThan(names.indexOf("height"));
    expect(names.indexOf("height")).toBeLessThan(
      names.indexOf("transformOrigin"),
    );
    expect(names.indexOf("transformOrigin")).toBeLessThan(
      names.indexOf("transform"),
    );
  });

  it("根节点读不到时一个字都不写", () => {
    const port = createStagePort({
      readRoot: () => null,
      readFrame: () => ({ width: 1600, height: 900 }),
    });

    expect(() =>
      port.apply(
        computeStageLayout({ width: 1600, height: 900 }, DEFAULT_STAGE_CONFIG),
      ),
    ).not.toThrow();
  });

  it("根节点读到 null 的瞬间不缓存：下一次读到节点就正常写", () => {
    const root = fakeRoot();
    let mounted: StageStyleTarget | null = null;
    const port = createStagePort({
      readRoot: () => mounted,
      readFrame: () => ({ width: 1600, height: 900 }),
    });
    const layout = computeStageLayout(
      { width: 1600, height: 900 },
      DEFAULT_STAGE_CONFIG,
    );

    port.apply(layout);
    mounted = root.target;
    port.apply(layout);

    expect(root.target.style.transform).toBe(stageTransform(layout));
  });

  it("measure 直通宿主读法：读数原样返回，不做换算", () => {
    const frame = { width: 1234, height: 567 };
    const port = createStagePort({
      readRoot: () => null,
      readFrame: () => frame,
    });

    expect(port.measure()).toBe(frame);
    expect(port.measure()).toEqual({ width: 1234, height: 567 });
  });

  it("幂等：同一布局连写两次，样式值与写入顺序都一致", () => {
    const root = fakeRoot();
    const port = createStagePort({
      readRoot: () => root.target,
      readFrame: () => ({ width: 1600, height: 900 }),
    });
    const layout = computeStageLayout(
      { width: 1600, height: 900 },
      DEFAULT_STAGE_CONFIG,
    );

    port.apply(layout);
    const firstRun = root.writes.map((write) => ({ ...write }));
    port.apply(layout);

    const secondRun = root.writes.slice(firstRun.length);
    expect(secondRun).toEqual(firstRun);
  });

  it("数值来自布局结果本身：换视口只改落笔值，不重算也不改基准", () => {
    const root = fakeRoot();
    let frame = { width: 1600, height: 900 };
    const port = createStagePort({
      readRoot: () => root.target,
      readFrame: () => frame,
    });

    port.apply(computeStageLayout(frame, DEFAULT_STAGE_CONFIG));
    const first = root.target.style.transform;

    frame = { width: 1000, height: 1000 };
    const layout = computeStageLayout(port.measure(), DEFAULT_STAGE_CONFIG);
    port.apply(layout);

    expect(root.target.style.transform).toBe(
      "translate(0px, 218.75px) scale(0.78125, 0.78125)",
    );
    expect(root.target.style.transform).not.toBe(first);
    expect(root.target.style.width).toBe(`${DEFAULT_STAGE_CONFIG.width}px`);
  });
});
