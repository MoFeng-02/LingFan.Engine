/**
 * 小程序宿主判据：舞台样式串口径、平台取用边界、取不到画布时的兜底、页面层单位口径。
 *
 * 平台侧只测「取不到就退回」的两条路（`uni` 缺失 / 节点查询不回调）——真机上画布一定有；
 * 这里要锁住的是别让页面卡在启动上。页面层用源级断言：全量渲染要真机，口径可以机械核对。
 */
import { computeStageLayout } from "../../packages/shell/src/stage/layout.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryCanvasNode } from "../../apps/wechat/src/host/platform.ts";
import { stageStyle } from "../../apps/wechat/src/host/view.ts";
import pageSource from "../../apps/wechat/src/pages/index/index.vue?raw";

/** 宿主各模块源码：平台全局的完成边界靠它机械核对 */
const hostSources = import.meta.glob("../../apps/wechat/src/host/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 去掉注释后再判平台全局：注释里提名字是文档，不算越界使用 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 造一个只在指定时机回执的节点查询替身 */
function fakeSelectorQuery(
  node: { width: number; height: number } | null,
  options: { silent?: boolean; throwing?: boolean } = {},
): unknown {
  return {
    createSelectorQuery: () => {
      if (options.throwing === true) throw new Error("该端不支持节点查询");
      const query = {
        select: () => query,
        node: (callback: (result: { node?: unknown }) => void) => {
          if (options.silent !== true) {
            callback(node === null ? {} : { node });
          }
          return query;
        },
        exec: () => undefined,
      };
      return query;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("stageStyle（舞台盒的行内样式）", () => {
  it("基准尺寸定死，平移在缩放之前——与布局计算的偏移口径一致", () => {
    const layout = computeStageLayout(
      { width: 800, height: 600 },
      { width: 1280, height: 720, fit: "contain" },
    );
    expect(stageStyle(layout)).toBe(
      "width:1280px;height:720px;transform:translate(0px,75px) scale(0.625,0.625)",
    );
  });

  it("小数截到三位：不把浮点尾巴带进样式串", () => {
    const layout = computeStageLayout(
      { width: 750, height: 1334 },
      { width: 1280, height: 720, fit: "contain" },
    );
    const style = stageStyle(layout);
    expect(style).toContain(
      `translate(${Math.round(layout.offsetX * 1000) / 1000}px`,
    );
    expect(style.length).toBeLessThan(96);
  });
});

describe("queryCanvasNode（取不到就退回）", () => {
  it("`uni` 缺失时返回 null，由装配器退回定时器帧源", async () => {
    await expect(queryCanvasNode("#stage-canvas")).resolves.toBeNull();
  });

  it("节点查询不回调时按超时收场，不让页面卡在启动上", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("uni", fakeSelectorQuery(null, { silent: true }));
    const pending = queryCanvasNode("#stage-canvas");
    await vi.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toBeNull();
  });

  it("查询本身抛错（该端没有节点查询）也按取不到处理", async () => {
    vi.stubGlobal("uni", fakeSelectorQuery(null, { throwing: true }));
    await expect(queryCanvasNode("#stage-canvas")).resolves.toBeNull();
  });

  it("拿到节点就原样交回", async () => {
    const canvas = { width: 375, height: 667 };
    vi.stubGlobal("uni", fakeSelectorQuery(canvas));
    await expect(queryCanvasNode("#stage-canvas")).resolves.toBe(canvas);
  });
});

describe("平台全局的完成边界", () => {
  it("`uni` 只出现在 platform.ts，其余宿主模块一律经此取件", () => {
    const offenders = Object.entries(hostSources)
      .filter(([path, source]) => {
        if (path.endsWith("/platform.ts")) return false;
        return /\buni\b/.test(stripComments(source));
      })
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});

describe("页面层的单位与层次口径", () => {
  it("舞台盒是唯一带变换的容器，官方页面单位只用 rpx", () => {
    expect(pageSource).toContain('class="stage-box" :style="stageBox"');
    expect(pageSource).toContain("transform-origin: 0 0");
    expect(pageSource).toContain("#stage-canvas");
    expect(pageSource).toContain("rpx");
    expect(pageSource).not.toMatch(/\d(vw|vh|vmin|vmax)\b/);
    expect(pageSource).not.toContain("clamp(");
  });

  it("对话 / 选择 / 通知三层各自按核心下发的 z 排层", () => {
    expect(pageSource).toContain("layerStyle('dialogue')");
    expect(pageSource).toContain("layerStyle('choices')");
    expect(pageSource).toContain("layerStyle('notifications')");
  });
});
