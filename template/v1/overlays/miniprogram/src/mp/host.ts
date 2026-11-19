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
  resolveAudioConfig,
  resolveSavesConfig,
  resolveStageConfig,
  resolveTextSpeed,
  slotIds,
  StoryEngine,
  SYS,
  videoFitOf,
  type SavesConfig,
  type StageConfig,
  type Story,
} from "@lingfan-engine/core";
import { createHttpI18nPort, loadProject } from "@lingfan-engine/adapters";
import {
  computeStageLayout,
  createHostI18n,
  withSlotLabels,
  type HostI18n,
  type StageLayout,
} from "@lingfan-engine/shell";
import {
  createAudioRenderer,
  createElementResourceResolver,
  createNarrativeOverlay,
  createVideoRenderer,
  type AudioRenderer,
  type NarrativeOverlay,
  type TypingSetting,
  type VideoRenderer,
} from "@lingfan-engine/ui";
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
// 语言清单来自构建期扫描 Resources/Lang/（虚拟模块声明在骨架 src/vite-env.d.ts，
// 生成工程两份清单同源）。小程序包体不装内容：译文与故事一样走工程接口的 HTTP 取件。
import { LANGS } from "virtual:lang-list";

/** 覆盖层字速兜底（字符/秒）：偏好与故事都没给合法值时用 */
const TEXT_SPEED = 30;

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
  /** 宿主语言门面：页面用它读当前语言/语言清单、t() 静态文案、切换语言 */
  i18n: HostI18n;
  overlay: NarrativeOverlay;
  ports: MiniprogramHostPorts;
  /**
   * 玩家偏好（已 hydrate）：设置面板读写音量/静音/字速都走它，不另建第二个实例。
   * 偏好独立于存档（机器级），面板改它即时生效并经端口防抖落盘。
   */
  preferences: PlayerPreferences;
  /** 当前舞台布局（视口 + 基准算出的缩放与偏移） */
  layout(): StageLayout;
  /** 视口尺寸变化后重算布局并下发 */
  resize(): void;
  /** 视频自然播完（页面 `bindended` 转发）：引擎据此解除 video 等待 */
  videoEnded(): void;
  /** 媒体与引擎状态对齐（读档/回溯完成后显式调用） */
  syncMedia(): void;
  /** 存档壳配置（槽数由工程清单 `shell.saves` 覆盖，缺省内建值） */
  saves: SavesConfig;
  /** 槽位 id 序列（面板呈现顺序） */
  slotIds: string[];
  /** 写入存档：回执来自引擎（失败文案由引擎通知，宿主不另编） */
  saveGame(slot: string): boolean;
  /** 读取存档：成功则媒体与投影各对齐一次 */
  loadGame(slot: string): boolean;
  /** 卸载：停帧循环、停媒体、退订状态、清空各层 */
  dispose(): void;
}

/** 启动小程序宿主：从工程接口装载故事并起叙事循环 */
export async function startMiniprogramHost(
  deps: MiniprogramHostDeps,
): Promise<MiniprogramHostHandle> {
  const projectBaseUrl = deps.projectBaseUrl ?? resolveProjectBaseUrl();
  const filesPort = createRemoteProjectFilesPort({
    baseUrl: projectBaseUrl,
    fetch: createRequestFetch(),
  });
  const story: Story = await loadProject(filesPort);

  // 存档槽数与缩略图参数来自同一份工程清单（`shell.saves` 逐键覆盖）：清单与故事是同一次
  // 装载（端口内 memo），这里再取一次不产生第二个请求。
  const manifest = await filesPort.manifest();
  const saves: SavesConfig = resolveSavesConfig(manifest);
  // 舞台基准与装入方式同样来自清单（`shell.stage`，逐键覆盖内建缺省）
  const stageConfig: StageConfig = resolveStageConfig(manifest);

  // 内容是包外的（故事走工程接口，改故事不必发版），守卫却在包里：装载完成先对名字，
  // 缺谁一次报全——错误停在起播之前，而不是播到那条命令才弹「未注册的守卫」。
  const missingGuards = findMissingGuards(story, guards);
  if (missingGuards.length > 0) {
    throw new Error(
      `故事引用了未注册的守卫：${missingGuards.join("、")}（宿主需在 src/mp/guards.ts 补齐实现）`,
    );
  }

  const videoSurface: MiniprogramVideoSurface = createMiniprogramVideoSurface({
    publish: (video) => deps.publish({ video }),
  });
  const ports = createMiniprogramHostPorts({
    videoSurface,
    projectBaseUrl,
    // 填充读当前列里的 video 元素：端口每次起播才求值，换列后自动跟随；
    // 引擎紧接着才构造，闭包里晚绑定正是所需（提前求值会读到未初始化）
    readFit: () => videoFitOf(engine.elements()),
  });
  // 译文供给与故事同源：Lang/ 走同一个工程基址，用 uni.request 包装的 HttpFetch 取件
  //（小程序没有全局 fetch）。端口先于引擎：setLanguage 按需经它加载 overlay。
  const i18nPort = createHttpI18nPort({
    langs: LANGS,
    root: projectBaseUrl,
    fetch: createRequestFetch(),
  });
  const engine = new StoryEngine(story, {
    // 工程默认音量（project.json shell.audio.volumes）：音量的第二级
    audioConfig: resolveAudioConfig(manifest),
    savePort: ports.save,
    i18nPort,
    texts: withSlotLabels(defaultEngineTexts),
    // 守卫实现由宿主随代码带上：故事 JSON 只写名字（装载期已校验名字齐全）
    guards,
  });
  // 语言门面绑同一个引擎：t()/changeLang 直转，currentLang 现读引擎状态
  const i18n = createHostI18n(engine, { i18nPort });

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
      // 视频音量同样乘玩家偏好（与音频同口径）：静音/调音量对两类媒体一致生效
      preferences,
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
    // 字速读偏好（与音频/视频同口径）：偏好 > 故事 > 内建兜底，归属由 textSpeedSource
    // 声明；现读口让滑杆改偏好后下一句即生效。偏好已水合，首帧起用的就是上次的字速。
    readTextSpeed: () =>
      resolveTextSpeed({
        player: preferences.textSpeed,
        source: preferences.textSpeedSource,
        story: (engine.get(SYS.typewriter) as TypingSetting | undefined)?.speed,
        fallback: TEXT_SPEED,
      }),
    resolveResource: elementResources.resolveForElement,
    onError: reportError,
    // 覆盖层的帧循环一直在跑：音频播放位置借它逐帧回写（与打字机同一条时间线）
    onFrame: () => audio.pollPosition(),
    // NVL 累积层读同一条渲染投影（桌面面板也是读它自己渲染）：表面把它翻成页面数据
    onView: (view) => surface.setNvl(view),
  });

  let layout = computeStageLayout(readWindowSize(), stageConfig);

  /** 读一次视口、重算布局并下发（初始化与尺寸变化共用） */
  function resize(): void {
    layout = computeStageLayout(readWindowSize(), stageConfig);
    deps.publish({ stageBox: stageStyle(layout) });
  }

  resize();
  engine.start();

  /** 媒体与投影对齐：读档/回溯后音频、视频与 NVL 要跟引擎状态重新对齐 */
  function syncMedia(): void {
    audio.sync();
    video.sync();
    // 覆盖层 sync 只重渲各层、不触发投影通知：NVL 也在这里补一次对齐
    surface.setNvl(overlay.view());
  }

  // 读档真正落地晚于命令返回：对齐挂在完成信号上，别在 `loadGame` 里当场同步。
  // 覆盖层 sync 是必须的——引擎重放只驱动「变化量」，读档后的整幅画面要靠一次全量重渲补齐。
  const stopLoadEvents = engine.onEvent((event) => {
    if (event.payload.kind !== "load.done") return;
    overlay.sync();
    syncMedia();
  });

  return {
    engine,
    i18n,
    overlay,
    ports,
    preferences,
    saves,
    slotIds: slotIds(saves.slots),
    layout: () => layout,
    resize,
    videoEnded: () => videoSurface.notifyEnded(),
    syncMedia,
    saveGame: (slot) => engine.save(slot),
    loadGame: (slot) => engine.load(slot),
    dispose: () => {
      stopLoadEvents();
      overlay.dispose();
      audio.dispose();
      video.dispose();
      engine.dispose();
      preferences.dispose();
    },
  };
}
