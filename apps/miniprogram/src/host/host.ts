/**
 * 小程序宿主装配：从远端工程到可跑的叙事覆盖层，一次接线到位。
 *
 * 接线顺序与嵌入演示一致——装载工程 → 建引擎（注入平台端口与文案）→ 建媒体渲染器 →
 * 建表面 → 建覆盖层 → 起帧循环。差别只有三处：工程来自工程接口而不是包内文件；
 * 表面把视图变成页面数据而不是 DOM 节点；舞台按视口与基准算出缩放再交给页面
 * （小程序没有 vw/vh 之类整体缩放手段）；媒体的位置回写借覆盖层的帧循环
 * （与打字机同一条时间线），视频播完由页面回传。
 *
 * 本文件是组合根：允许它同时知道引擎、展示层与平台，别处不允许这样横跨。
 */
import {
  defaultEngineTexts,
  findMissingGuards,
  PlayerPreferences,
  StoryEngine,
  type Story,
} from "@lingfan/engine";
import { loadProject } from "@lingfan/adapters";
import {
  computeStageLayout,
  DEFAULT_STAGE_FIT,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  withSlotLabels,
  type StageConfig,
  type StageLayout,
} from "@lingfan/shell";
import {
  createAudioRenderer,
  createElementResourceResolver,
  createNarrativeOverlay,
  createVideoRenderer,
  type AudioRenderer,
  type NarrativeOverlay,
  type VideoRenderer,
} from "@lingfan/ui";
import { createHostFrameSource } from "./frame.ts";
import {
  createRequestFetch,
  readWindowSize,
  type MiniprogramCanvasNode,
} from "./platform.ts";
import {
  createMiniprogramHostPorts,
  type MiniprogramHostPorts,
} from "./ports.ts";
import {
  createRemoteProjectFilesPort,
  resolveProjectBaseUrl,
} from "./project-source.ts";
import { guards } from "./guards.ts";
import {
  createMiniprogramOverlaySurface,
  type MiniprogramSurfacePatch,
} from "./surface.ts";
import {
  createMiniprogramVideoSurface,
  type MiniprogramVideoData,
  type MiniprogramVideoSurface,
} from "./video-surface.ts";
import { stageStyle } from "./view.ts";

/** 覆盖层字速（字符/秒） */
const TEXT_SPEED = 30;

/** 舞台基准与装入方式：1280×720 等比装入视口（换基准改这里即可） */
const STAGE_CONFIG: StageConfig = {
  width: DEFAULT_STAGE_WIDTH,
  height: DEFAULT_STAGE_HEIGHT,
  fit: DEFAULT_STAGE_FIT,
};

/** 页面数据补丁：覆盖层各层 + 视频状态 + 舞台尺寸串 + 错误横幅 */
export type MiniprogramHostPatch = MiniprogramSurfacePatch & {
  stageBox?: string;
  video?: MiniprogramVideoData;
  error?: string;
};

/** 宿主装配参数 */
export interface MiniprogramHostDeps {
  /** 页面数据发布口 */
  publish(patch: MiniprogramHostPatch): void;
  /** 画布节点（有则用它做帧源；无则退回定时器帧源） */
  canvas?: MiniprogramCanvasNode | null;
  /** 工程基址（故事与资源都从它取）；缺省读运行期配置 */
  projectBaseUrl?: string;
}

/** 宿主句柄：页面用它做重算、媒体回传、销毁与调试观测 */
export interface MiniprogramHostHandle {
  engine: StoryEngine;
  overlay: NarrativeOverlay;
  ports: MiniprogramHostPorts;
  /** 当前舞台布局（视口 + 基准算出的缩放与偏移） */
  layout(): StageLayout;
  /** 视口尺寸变化后重算布局并下发 */
  resize(): void;
  /** 视频自然播完（页面 `bindended` 转发）：引擎据此解除 video 等待 */
  videoEnded(): void;
  /** 媒体与引擎状态对齐（读档/回溯完成后显式调用） */
  syncMedia(): void;
  /** 卸载：停帧循环、停媒体、退订状态、清空各层 */
  dispose(): void;
}

/** 启动小程序宿主：从工程接口装载故事并起叙事循环 */
export async function startMiniprogramHost(
  deps: MiniprogramHostDeps,
): Promise<MiniprogramHostHandle> {
  const projectBaseUrl = deps.projectBaseUrl ?? resolveProjectBaseUrl();
  const story: Story = await loadProject(
    createRemoteProjectFilesPort({
      baseUrl: projectBaseUrl,
      fetch: createRequestFetch(),
    }),
  );

  // 内容是包外的（故事走工程接口，改故事不必发版），守卫却在包里：装载完成先对名字，
  // 缺谁一次报全——错误停在起播之前，而不是播到那条命令才弹「未注册的守卫」。
  const missingGuards = findMissingGuards(story, guards);
  if (missingGuards.length > 0) {
    throw new Error(
      `故事引用了未注册的守卫：${missingGuards.join("、")}（宿主需在 src/host/guards.ts 补齐实现）`,
    );
  }

  const videoSurface: MiniprogramVideoSurface = createMiniprogramVideoSurface({
    publish: (video) => deps.publish({ video }),
  });
  const ports = createMiniprogramHostPorts({ videoSurface, projectBaseUrl });
  const engine = new StoryEngine(story, {
    savePort: ports.save,
    texts: withSlotLabels(defaultEngineTexts),
    // 守卫实现由宿主随代码带上：故事 JSON 只写名字（装载期已校验名字齐全）
    guards,
  });

  // 玩家偏好在渲染器之前水合：首帧起用的就是上次的音量，不必等下一次用户操作
  const preferences = new PlayerPreferences(ports.preferences);
  await preferences.hydrate();

  /** 诊断出口：媒体装配失败与覆盖层运行时错误都落到同一条出口（fail-closed：不播，但不静默） */
  const reportError = (message: string): void => {
    deps.publish({ error: message });
  };

  // 音频渲染器与视频渲染器都按引擎状态做差量；构造即订阅，先于覆盖层建好不影响语义。
  const audio: AudioRenderer = createAudioRenderer(
    engine,
    ports.audio,
    ports.resources,
    { onError: reportError, preferences },
  );
  const video: VideoRenderer = createVideoRenderer(
    engine,
    ports.video,
    ports.resources,
    {
      onError: reportError,
      // 组合根职责：cutscene 播完 → 引擎解除 video 等待
      onVideoFinished: () => engine.videoFinished(),
    },
  );

  const surface = createMiniprogramOverlaySurface({
    frame: createHostFrameSource(deps.canvas ?? null),
    publish: deps.publish,
  });

  // 元素资源解析是异步的而元素渲染是同步的：用现成的同步查表皮接上，
  // 解析完成后要求覆盖层补一次重渲（回调延后读 overlay，故用闭包而非参数）。
  const elementResources = createElementResourceResolver({
    resolve: (path) => ports.resources.resolve(path),
    onResolved: () => overlay.sync(),
  });
  const overlay: NarrativeOverlay = createNarrativeOverlay({
    surface,
    engine,
    textSpeed: TEXT_SPEED,
    resolveResource: elementResources.resolveForElement,
    onError: reportError,
    // 覆盖层的帧循环一直在跑：音频播放位置借它逐帧回写（与打字机同一条时间线）
    onFrame: () => audio.pollPosition(),
    // NVL 累积层读同一条渲染投影（桌面面板也是读它自己渲染）：表面把它翻成页面数据
    onView: (view) => surface.setNvl(view),
  });

  let layout = computeStageLayout(readWindowSize(), STAGE_CONFIG);

  /** 读一次视口、重算布局并下发（初始化与尺寸变化共用） */
  function resize(): void {
    layout = computeStageLayout(readWindowSize(), STAGE_CONFIG);
    deps.publish({ stageBox: stageStyle(layout) });
  }

  resize();
  engine.start();

  return {
    engine,
    overlay,
    ports,
    layout: () => layout,
    resize,
    videoEnded: () => videoSurface.notifyEnded(),
    syncMedia: () => {
      audio.sync();
      video.sync();
      // 覆盖层 sync 只重渲各层、不触发投影通知：NVL 也在这里补一次对齐
      surface.setNvl(overlay.view());
    },
    dispose: () => {
      overlay.dispose();
      audio.dispose();
      video.dispose();
      engine.dispose();
      preferences.dispose();
    },
  };
}
