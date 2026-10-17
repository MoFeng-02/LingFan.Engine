/**
 * 小程序宿主判据：舞台样式串口径、平台取用边界、取不到画布时的兜底、页面层单位口径。
 *
 * 平台侧只测「取不到就退回」的两条路（`uni` 缺失 / 节点查询不回调）——真机上画布一定有；
 * 这里要锁住的是别让页面卡在启动上。页面层用源级断言：全量渲染要真机，口径可以机械核对。
 */
import { computeStageLayout } from "../../packages/shell/src/stage/layout.ts";
import type { HttpFetch } from "@lingfan/adapters";
import {
  assembleProject,
  collectGuardNames,
  findMissingGuards,
} from "@lingfan/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import appPackage from "../../apps/miniprogram/package.json?raw";
import { guards } from "../../apps/miniprogram/src/host/guards.ts";
import hostSource from "../../apps/miniprogram/src/host/host.ts?raw";
import {
  createRequestFetch,
  queryCanvasNode,
} from "../../apps/miniprogram/src/host/platform.ts";
import portsSource from "../../apps/miniprogram/src/host/ports.ts?raw";
import {
  createRemoteProjectFilesPort,
  createRemoteResourcePort,
  DEFAULT_PROJECT_BASE_URL,
  normalizeProjectBaseUrl,
  projectEndpointUrl,
} from "../../apps/miniprogram/src/host/project-source.ts";
import {
  createMiniprogramVideoSurface,
  VIDEO_COMPONENT_ID,
  type MiniprogramVideoData,
} from "../../apps/miniprogram/src/host/video-surface.ts";
import {
  createMiniprogramOverlaySurface,
  type MiniprogramNvlData,
} from "../../apps/miniprogram/src/host/surface.ts";
import { renderDialogueLine, type NarrativeOverlayView } from "@lingfan/ui";
import dialoguePanelSource from "../../apps/playground/src/App/DialoguePanel.vue?raw";
import { stageStyle } from "../../apps/miniprogram/src/host/view.ts";
import manifestSource from "../../apps/miniprogram/src/manifest.json?raw";
import pagesSource from "../../apps/miniprogram/src/pages.json?raw";
import pageSource from "../../apps/miniprogram/src/pages/index/index.vue?raw";
import projectManifestSource from "../../apps/miniprogram/project/project.json?raw";

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

/** 包外演示工程的文件清单：键是工程内逻辑路径（`Stories/…`、`Audio/…`） */
const projectFiles = new Set(
  Object.keys(
    import.meta.glob("../../apps/miniprogram/project/**/*", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map((path) => {
    const mark = "/project/";
    return path.slice(path.indexOf(mark) + mark.length);
  }),
);

/** 演示工程的故事原文（构建期收集，只用于判资源引用完整性） */
const demoStorySources = import.meta.glob(
  "../../apps/miniprogram/project/Stories/**/*.json",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 演示故事原文：逻辑路径（`Stories/…`）→ 文本 */
const demoStoryFiles: Record<string, string> = (() => {
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(demoStorySources)) {
    const mark = "/project/";
    files[path.slice(path.indexOf(mark) + mark.length)] = text;
  }
  return files;
})();

/** 收集故事里被引用的资源 id（op 的 `resource` 字段，含嵌套与数组） */
function collectResourceIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectResourceIds(item, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "resource" && typeof item === "string") into.add(item);
    else collectResourceIds(item, into);
  }
}

/** 演示故事引用到的全部资源 id */
function demoResourceIds(): string[] {
  const ids = new Set<string>();
  for (const text of Object.values(demoStoryFiles)) {
    collectResourceIds(JSON.parse(text) as unknown, ids);
  }
  return [...ids].sort();
}

/** 演示工程组装出的故事：用引擎自己的组装器，测试里不另写一份解析 */
const demoStory = assembleProject(
  JSON.parse(projectManifestSource) as unknown,
  new Map(Object.entries(demoStoryFiles)),
);

/** 造一个固定回包的取件面（工程接口替身），顺带记账请求次数 */
function serveProject(
  body: unknown,
  status = 200,
): { fetch: HttpFetch; calls: string[] } {
  const calls: string[] = [];
  const payload = JSON.stringify(body);
  const fetch: HttpFetch = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => payload,
    };
  };
  return { fetch, calls };
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

describe("屏幕方向（横屏支持）", () => {
  it("页面声明 auto 方向：允许系统旋转，锁定方向改这一处", () => {
    const pages = JSON.parse(pagesSource) as {
      pages: { path: string; style?: { pageOrientation?: string } }[];
    };
    const page = pages.pages.find((item) => item.path === "pages/index/index");
    // 微信页面配置：auto = 跟随系统旋转（2.4.0+），landscape = 强制横屏（2.5.0+）
    expect(page?.style?.pageOrientation).toBe("auto");
  });

  it("层高用视口百分比：横屏时 rpx 基准换成大宽度也不会把卡片撑出屏", () => {
    expect(pageSource).toContain("min-height: 16%");
    expect(pageSource).toContain("min-height: 46%");
    // 固定 rpx 高度是横屏的坑：竖屏 600rpx 在横屏会变成近 700px，直接盖满屏
    expect(pageSource).not.toMatch(/min-height:\s*\d+rpx/);
  });

  it("横屏排版改用 px：rpx 会随宽度放大字号与内边距", () => {
    expect(pageSource).toContain("@media (orientation: landscape)");
    const landscape = pageSource.slice(
      pageSource.indexOf("@media (orientation: landscape)"),
    );
    expect(landscape).toContain("font-size: 16px");
    expect(landscape).toContain("padding: 12px 16px");
    // 方向切换后宿主负责重算舞台：页面订阅窗口尺寸变化（旋转会触发 uni 的 onWindowResize）
    expect(pageSource).toContain("watchWindowResize");
    expect(pageSource).toContain("started.resize()");
  });
});

describe("宿主身份中立（UniApp 不止微信一端）", () => {
  it("包名与页面源码都不带厂商名：换端只动 platform.ts 的取用面，不动宿主身份", () => {
    expect(appPackage).toContain('"name": "@lingfan/miniprogram"');
    expect(pageSource).not.toMatch(/\bwx\b|WeChat|wechat/i);
  });

  it("宿主模块的代码里没有厂商专属 API：换端只换 platform.ts 的取用面", () => {
    const offenders = Object.entries(hostSources)
      .filter(([, source]) =>
        /\bwx\b|WeChat|Wechat|wechat/.test(stripComments(source)),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("端口装配取自中立适配器族：统一能力面而非某家 API", () => {
    expect(portsSource).toContain("createMiniprogramSavePort");
    expect(portsSource).not.toMatch(/Wechat|wechat/);
  });
});

describe("演示工程走工程接口（包体只装代码）", () => {
  it("清单与故事从工程接口一次取回：端点 = 基址 + `project`", async () => {
    const { fetch, calls } = serveProject({
      manifest: JSON.parse(projectManifestSource),
      stories: demoStoryFiles,
    });
    const port = createRemoteProjectFilesPort({
      baseUrl: "https://cdn.test/",
      fetch,
    });
    await expect(port.manifest()).resolves.toMatchObject({ formatVersion: 1 });

    const stories = await port.stories();
    expect(stories.size).toBeGreaterThanOrEqual(10);
    expect([...stories.keys()].every((key) => key.startsWith("Stories/"))).toBe(
      true,
    );
    // 故事文本照原样交回（解析归引擎的组装器）——坏一份就整包组装失败
    for (const text of stories.values()) {
      expect(() => JSON.parse(text) as unknown).not.toThrow();
    }
    expect(calls).toEqual(["https://cdn.test/project"]);
  });

  it("基址必须是 http(s) 绝对地址且以 / 结尾：拼坏地址要在启动时暴露", () => {
    expect(DEFAULT_PROJECT_BASE_URL).toBe("http://127.0.0.1:5273/");
    expect(normalizeProjectBaseUrl("https://cdn.test")).toBe(
      "https://cdn.test/",
    );
    expect(() => normalizeProjectBaseUrl("/api/")).toThrow(
      "工程基址必须是 http(s) 绝对地址",
    );
    expect(projectEndpointUrl("https://cdn.test/media")).toBe(
      "https://cdn.test/media/project",
    );
  });

  it("工程接口失败 → 启动即失败：不降级成空工程", async () => {
    const { fetch } = serveProject({ manifest: {} }, 502);
    const port = createRemoteProjectFilesPort({ fetch });
    await expect(port.stories()).rejects.toThrow("HTTP 502");
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
    expect(portsSource).toContain(
      "createMiniprogramAudioPort(createAudioContext)",
    );
    expect(portsSource).toContain(
      "createMiniprogramVideoPort(options.videoSurface)",
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

describe("NVL 累积层（对话容器的另一种形态）", () => {
  /** 造一个只收 NVL 补丁的表面：帧源给空实现（这组用例不走帧循环） */
  function makeSurface(): {
    patches: (MiniprogramNvlData | null)[];
    setNvl: (view: NarrativeOverlayView) => void;
    clear: () => void;
  } {
    const patches: (MiniprogramNvlData | null)[] = [];
    const surface = createMiniprogramOverlaySurface({
      frame: { request: () => 0, cancel: () => undefined },
      publish: (patch) => {
        if (patch.nvl !== undefined) patches.push(patch.nvl);
      },
    });
    return {
      patches,
      setNvl: (view) => surface.setNvl(view),
      clear: () => surface.clear(),
    };
  }

  /** 投影快照：NVL 激活时累积两行，第二行正在打 */
  function nvlView(lines: string[], typing: string): NarrativeOverlayView {
    return {
      speaker: "",
      text: lines.at(-1) ?? "",
      lineHtml: typing,
      canAdvance: false,
      waiting: "dialog",
      menuPrompt: "",
      menuOptions: [],
      inputPrompt: "",
      nvlMode: "active",
      nvlLines: lines,
      hasElements: false,
    };
  }

  it("激活时把累积行翻成 HTML、最新一行只给打字前缀", () => {
    const surface = makeSurface();
    surface.setNvl(nvlView(["第一段。", "第二段"], "第二"));
    expect(surface.patches).toEqual([
      {
        pastLines: [renderDialogueLine({ text: "第一段。" }).html],
        typingHtml: "第二",
      },
    ]);
  });

  it("累积行只按缓冲变化重算：打字帧复用同一份 HTML 数组", () => {
    const surface = makeSurface();
    const lines = ["第一段。", "第二段"];
    surface.setNvl(nvlView(lines, "第"));
    surface.setNvl(nvlView(lines, "第二"));
    const [first, second] = surface.patches;
    expect(second?.typingHtml).toBe("第二");
    // 同一份缓冲 ⇒ 已打完行的 html 数组引用不变（打字帧不重算累积行）
    expect(second?.pastLines).toBe(first?.pastLines);
  });

  it("退出 NVL（mode 非 active 或没有累积行）⇒ 落 null，页面回三段式", () => {
    const surface = makeSurface();
    surface.setNvl(nvlView(["只剩一行"], "只"));
    surface.setNvl({ ...nvlView(["a"], "a"), nvlMode: "none" });
    surface.setNvl({ ...nvlView([], "") });
    expect(surface.patches.at(-1)).toBeNull();
    // 已经不在 NVL 时不重复下发
    surface.setNvl({ ...nvlView(["a"], "a"), nvlMode: "none" });
    expect(surface.patches).toHaveLength(2);
  });

  it("卸载时把 NVL 一并清空：清层就是四个层都归零", () => {
    const surface = makeSurface();
    surface.setNvl(nvlView(["一行"], "一"));
    surface.clear();
    expect(surface.patches.at(-1)).toBeNull();
  });

  it("组合根把投影接到表面上：onView 是唯一通道（NVL 不在表面契约里）", () => {
    expect(hostSource).toContain("onView: (view) => surface.setNvl(view)");
    // 读档/回溯后覆盖层 sync 不发投影通知，这里要显式补一次
    expect(hostSource).toMatch(/surface\.setNvl\(overlay\.view\(\)\)/);
  });

  it("页面按 NVL 形态换内容而不是换层：累积行与打字行都绑在对话层里", () => {
    expect(pageSource).toContain('class="nvl-body"');
    expect(pageSource).toContain("nvl.pastLines");
    expect(pageSource).toContain("nvl.typingHtml");
    expect(pageSource).toContain("'nvl-mode'");
    expect(pageSource).toContain("patch.nvl");
  });

  it("面板视觉与桌面同源：同名结构与同色值，改形态时两处一起改", () => {
    // 结构锚点：两端都按这套类名排版（一份视觉语言两处落地）
    for (const anchor of [
      ".nvl-body",
      ".advance-hint",
      ".layer-prompt",
      ".choice-row",
      ".dialogue.tpl-center",
    ]) {
      expect(pageSource).toContain(anchor);
      expect(dialoguePanelSource).toContain(anchor);
    }
    // 底卡与文字配色同源（同一批色值在两边出现；底色两端一个写 rgba 一个写 #1e1e2ecc）
    for (const color of ["#7aa2f7", "#9aa5ce", "#e6e6f0", "blink"]) {
      expect(pageSource).toContain(color);
      expect(dialoguePanelSource).toContain(color);
    }
    // 桌面是基准文件：它变了这条会跟着失效，提示回来看小程序
    expect(dialoguePanelSource).toContain("--lf-story-font");
  });
});

describe("演示内容与资源都在包外（HTTP 取）", () => {
  it("资源端口把故事 id 拼到工程基址下：换服务端地址不动故事与代码", async () => {
    const port = createRemoteResourcePort("https://cdn.test/");
    await expect(port.resolve("Audio/crickets_night01.mp3")).resolves.toBe(
      "https://cdn.test/Audio/crickets_night01.mp3",
    );
    await expect(port.resolve("Video/m1.mp4")).resolves.toBe(
      "https://cdn.test/Video/m1.mp4",
    );
    // 基址没写尾斜杠也补齐（否则会拼出 https://cdn.test/cdnVideo/…）
    await expect(
      createRemoteResourcePort("https://cdn.test/cdn").resolve("Video/m1.mp4"),
    ).resolves.toBe("https://cdn.test/cdn/Video/m1.mp4");
    // 路径穿越仍走资源域的同一份规则：信任边界上拒绝
    await expect(port.resolve("../secret.mp4")).rejects.toThrow("资源路径非法");
  });

  it("端口装配走远端资源根：宿主不再持有包内资源根", () => {
    expect(portsSource).toContain(
      "resources: createRemoteResourcePort(options.projectBaseUrl),",
    );
    expect(portsSource).not.toMatch(/static\/|PACKAGE_RESOURCE_ROOT/);
  });

  it("组合根用平台取件面装载工程：不在包里收集故事文件", () => {
    expect(hostSource).toContain("createRequestFetch()");
    expect(hostSource).toContain("createRemoteProjectFilesPort(");
    expect(hostSource).not.toContain("import.meta.glob");
    expect(hostSource).not.toContain("fixture");
  });

  it("包体里没有工程内容：故事与素材都只在包外的 project/ 目录", () => {
    expect(
      Object.keys(
        import.meta.glob("../../apps/miniprogram/src/static/**/*", {
          eager: true,
        }),
      ),
    ).toEqual([]);
    expect(
      Object.keys(
        import.meta.glob("../../apps/miniprogram/src/fixture/**/*", {
          eager: true,
        }),
      ),
    ).toEqual([]);
    expect(projectFiles.has("project.json")).toBe(true);
    expect([...projectFiles].some((path) => path.startsWith("Stories/"))).toBe(
      true,
    );
  });

  it("演示故事引用的每个资源都在包外工程里：缺一个就是哑音或黑屏", () => {
    const ids = demoResourceIds();
    // 演示流程真的覆盖了音频与视频两类，不只是留了端口代码
    expect(ids).toEqual(
      expect.arrayContaining([
        "Audio/crickets_night01.mp3",
        "Audio/chest_drawer_open.mp3",
        "Video/m1.mp4",
      ]),
    );
    expect(ids.filter((id) => !projectFiles.has(id))).toEqual([]);
  });

  it("演示故事引用的守卫都在宿主注册表里：缺一个就是启动即失败", () => {
    const names = collectGuardNames(demoStory);
    expect(names.length).toBeGreaterThan(0);
    expect(findMissingGuards(demoStory, guards)).toEqual([]);
    // 组合根把注册表交给引擎，并在装载后先对名字：只登记不接线、或只在运行期才查，
    // 都会退化成「播到那条命令才弹未注册」
    expect(hostSource).toMatch(/new StoryEngine\(story, \{[\s\S]*guards,/);
    expect(hostSource).toMatch(/findMissingGuards\(story, guards\)/);
  });
});

describe("取件面（uni.request → fetch 形状）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("成功回执：状态码决定 ok，原文照交（故事不交给平台解析）", async () => {
    const request = vi.fn(
      (options: {
        success(result: { statusCode: number; data: unknown }): void;
      }) => {
        options.success({
          statusCode: 200,
          data: '{"manifest":{"entry":"x"}}',
        });
      },
    );
    vi.stubGlobal("uni", { request });

    const response = await createRequestFetch()("https://cdn.test/project");
    expect(response.ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://cdn.test/project",
        method: "GET",
        dataType: "text",
      }),
    );
    await expect(response.text()).resolves.toBe('{"manifest":{"entry":"x"}}');
  });

  it("非 2xx 状态码：ok 为 false，状态码原样交回（由装载方 fail-closed）", async () => {
    vi.stubGlobal("uni", {
      request: (options: {
        success(result: { statusCode: number; data: unknown }): void;
      }) => {
        options.success({ statusCode: 404, data: "没有这个工程" });
      },
    });
    const response = await createRequestFetch()("https://cdn.test/project");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });

  it("失败回执：reject 带可读原因，不让宿主拿着半个工程继续跑", async () => {
    vi.stubGlobal("uni", {
      request: (options: { fail(error: { errMsg?: string }): void }) => {
        options.fail({ errMsg: "request:fail timeout" });
      },
    });
    await expect(
      createRequestFetch()("https://cdn.test/project"),
    ).rejects.toThrow("请求失败：request:fail timeout");
  });
});
