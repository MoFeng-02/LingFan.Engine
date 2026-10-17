/**
 * 小程序宿主判据：舞台样式串口径、平台取用边界、取不到画布时的兜底、页面层单位口径。
 *
 * 平台侧只测「取不到就退回」的两条路（`uni` 缺失 / 节点查询不回调）——真机上画布一定有；
 * 这里要锁住的是别让页面卡在启动上。页面层用源级断言：全量渲染要真机，口径可以机械核对。
 */
import { computeStageLayout } from "../../packages/shell/src/stage/layout.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import appPackage from "../../apps/miniprogram/package.json?raw";
import { createFixtureProjectFilesPort } from "../../apps/miniprogram/src/host/fixture.ts";
import hostSource from "../../apps/miniprogram/src/host/host.ts?raw";
import { queryCanvasNode } from "../../apps/miniprogram/src/host/platform.ts";
import portsSource from "../../apps/miniprogram/src/host/ports.ts?raw";
import {
  createMiniprogramVideoSurface,
  VIDEO_COMPONENT_ID,
  type MiniprogramVideoData,
} from "../../apps/miniprogram/src/host/video-surface.ts";
import { stageStyle } from "../../apps/miniprogram/src/host/view.ts";
import manifestSource from "../../apps/miniprogram/src/manifest.json?raw";
import pageSource from "../../apps/miniprogram/src/pages/index/index.vue?raw";

/** 宿主各模块源码：平台全局的完成边界靠它机械核对 */
const hostSources = import.meta.glob("../../apps/miniprogram/src/host/*.ts", {
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

describe("宿主身份中立（UniApp 不止微信一端）", () => {
  it("包名与页面源码都不带平台专属名：换端只动 adapters 取件，不动宿主身份", () => {
    expect(appPackage).toContain('"name": "@lingfan/miniprogram"');
    expect(pageSource).not.toMatch(/wechat/i);
  });
});

describe("内建演示工程随包可达", () => {
  it("包内供给口能交出清单与故事：示例工程缺一不可，缺了引擎会整包拒绝", async () => {
    const port = createFixtureProjectFilesPort();
    const manifest = (await port.manifest()) as {
      formatVersion?: number;
      entry?: string;
    };
    expect(manifest.formatVersion).toBe(1);
    expect(typeof manifest.entry).toBe("string");

    const stories = await port.stories();
    expect(stories.size).toBeGreaterThanOrEqual(10);
    expect([...stories.keys()].every((key) => key.startsWith("Stories/"))).toBe(
      true,
    );
    // 每份都必须是可解析的 JSON：供给口交出去的是文本，坏一份就整包组装失败
    for (const text of stories.values()) {
      expect(() => JSON.parse(text) as unknown).not.toThrow();
    }
  });

  it("清单与基库版本显式给定：IDE 读到空串会拿不确定的默认值", () => {
    const manifest = JSON.parse(manifestSource) as {
      "mp-weixin"?: { appid?: string; libVersion?: string };
    };
    const weixin = manifest["mp-weixin"];
    expect(weixin?.appid?.trim()).toBeTruthy();
    expect(weixin?.libVersion?.trim()).toBeTruthy();
  });
});

describe("媒体端口接线（音频实例与视频呈现面）", () => {
  /** 收集页面补丁的替身 */
  function collectPatches(): {
    patches: MiniprogramVideoData[];
    publish: (video: MiniprogramVideoData) => void;
  } {
    const patches: MiniprogramVideoData[] = [];
    return { patches, publish: (video) => patches.push(video) };
  }

  it("起播把片源、可见性与音量落到页面数据：换片与显隐由组件属性决定", () => {
    const { patches, publish } = collectPatches();
    const surface = createMiniprogramVideoSurface({ publish });
    surface.show({
      url: "https://example.test/op.webm",
      volume: 0.5,
      loop: true,
    });
    expect(patches).toEqual([
      {
        url: "https://example.test/op.webm",
        visible: true,
        volume: 0.5,
        loop: true,
      },
    ]);
  });

  it("停止把页面数据归零：不可见即不占位，也不盖住舞台", () => {
    const { patches, publish } = collectPatches();
    const surface = createMiniprogramVideoSurface({ publish });
    surface.show({ url: "a.webm", volume: 1, loop: false });
    surface.hide();
    expect(patches.at(-1)).toEqual({
      url: "",
      visible: false,
      volume: 0,
      loop: false,
    });
  });

  it("控制动作在无控制柄时静默丢弃：组件未渲染不该炸掉宿主", () => {
    const { publish } = collectPatches();
    const surface = createMiniprogramVideoSurface({ publish });
    surface.show({ url: "a.webm", volume: 1, loop: false });
    // `uni` 缺失 ⇒ 取柄抛错；三个动作都必须吞掉这次失败
    expect(() => {
      surface.pause();
      surface.resume();
      surface.seek(3);
    }).not.toThrow();
  });

  it("播完回传走注册的处理器：组件 bindended → 引擎解除 video 等待", () => {
    const { publish } = collectPatches();
    const surface = createMiniprogramVideoSurface({ publish });
    const ended = vi.fn();
    surface.onEnded(ended);
    surface.notifyEnded();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("页面组件的 id 与呈现面取柄用的 id 同源：改名不会只改一半", () => {
    expect(VIDEO_COMPONENT_ID).toBe("stage-video");
    expect(pageSource).toContain(`id="${VIDEO_COMPONENT_ID}"`);
    expect(pageSource).toContain('@ended="onVideoEnded"');
    expect(pageSource).toContain("layerStyle('video')");
    expect(pageSource).toContain("host?.videoEnded()");
  });

  it("组合根把两个渲染器都接上，并在帧源里回写音频位置、销毁时一并收场", () => {
    // 端口由适配器工厂造（音频实例从平台取，视频呈现面由组合根注入）
    expect(portsSource).toContain("createWechatAudioPort(createAudioContext)");
    expect(portsSource).toContain(
      "createWechatVideoPort(options.videoSurface)",
    );
    // 渲染器：音频带偏好，视频播完交回引擎
    expect(hostSource).toContain("createAudioRenderer(");
    expect(hostSource).toContain("createVideoRenderer(");
    expect(hostSource).toContain(
      "onVideoFinished: () => engine.videoFinished()",
    );
    // 位置回写与打字机同帧（不另起定时器）
    expect(hostSource).toContain("() => audio.pollPosition()");
    // 卸载时媒体与引擎一起收场
    expect(hostSource).toMatch(
      /dispose: \(\) => \{[\s\S]*audio\.dispose\(\);[\s\S]*video\.dispose\(\);/,
    );
  });
});
