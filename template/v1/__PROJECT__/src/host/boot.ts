/**
 * 启动装配：端口 → 工程 → 引擎 → 视图 → 订阅 → 帧循环 → 开跑。
 *
 * 顺序是有约束的，不是随手排的：
 * 1. 端口先于引擎（引擎构造要吃存档端口）；
 * 2. 层级表先落一次 DOM（此时视频端口还没建，视频层不参与）；
 * 3. 视图先于订阅（订阅一建立就会回调，视图必须已经能接住）；
 * 4. `engine.start()` 最后（此前任何一次状态回调都还没有订阅者，也不该有）。
 *
 * 可配置项都走具名选项，缺省值即本宿主的现状取值：宿主换一个工程或换一套节律时
 * 只改组合根传进来的值，不动本文件。
 */

import {
  SYS,
  PlayerPreferences,
  StoryEngine,
  resolveAudioConfig,
  resolveLayerZ,
  type AudioPort,
  type PreferencesPort,
  type ProjectFilesPort,
  type ResourcePort,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan-engine/core";
import {
  createFetchProjectFilesPort,
  createStaticResourcePort,
  createWebAudioPort,
  createWebStoragePreferencesPort,
  createWebStorageSavePort,
  createWebVideoPort,
  loadProject,
} from "@lingfan-engine/adapters";
import {
  DEFAULT_TEXT_CPS,
  DEFAULT_TOAST_MS,
  createAudioRenderer,
  createVideoRenderer,
  type ScreenView,
  type TypingSetting,
} from "@lingfan-engine/ui";
import { createErrorReporter, type StageDom } from "./stage-dom";
import { createHostLayerZ } from "./layer-z";
import { fillSaveSlots, wireSaveSlots } from "./save-slots";
import { createToast } from "./toast";
import { createDialogueView } from "./dialogue-view";
import { createHostEffects } from "./effects";
import { wireEngine } from "./engine-wiring";
import { startHostFrameLoop } from "./frame-loop";
import { wireInput } from "./input-map";
import { installStoryFonts } from "./theme-fonts";
import { createPreferencesPanel } from "./panels/preferences";
import { createScreenSwitch } from "./switch";
import { createNativeMountRenderer } from "./mount/index";

/**
 * 装配输入：节点句柄表、资源根内的清单与故事表，以及两项可配置节律。
 * 取值全部由组合根给定——本文件不含宿主特有的字面量。
 */
export interface HostBootOptions {
  /** 常驻节点句柄表（由组合根解析 `#id` 得到） */
  dom: StageDom;
  /** 工程清单的逻辑路径（相对资源根） */
  manifestFile: string;
  /** 故事文件的逻辑路径表（相对资源根；新增故事必须同步此表） */
  stories: readonly string[];
  /** 故事未声明字速时的兜底（可见字符 / 秒）；缺省 = 展示层给出的默认字速 */
  defaultCps?: number;
  /** 提示条驻留毫秒数；缺省 = 展示层给出的默认时长 */
  toastDurationMs?: number;
  /**
   * 端口覆盖：换平台形态时由组合根传入原生实现，装配顺序与接线一行不改。
   * 缺省走 Web 形态（静态资源根 + localStorage 存档 + fetch 取工程文件）。
   */
  ports?: BootPortOverrides;
  /**
   * 偏好面板的挂载容器（可选）：给了就装配四通道音量 / 静音 / 字速面板，
   * 不给就不装——页面结构归组合根，宿主不自己造节点，也不往 `body` 里塞。
   *
   * 谁给容器谁负责它的 z 序与显隐；面板根自带 `data-ui-zone`（否则滚轮会连带回溯）。
   */
  prefsContainer?: HTMLElement | null;
  /**
   * UI 挂载层容器（可选）：给了就按 `SYS.mounts` 把 `src/ui/` 下的 UI 挂进来。
   *
   * 容器由组合根提供并常驻（宿主不新建也不摘除它，变化只动它的子节点）。UI 表来自
   * 生成物 `src/gen/ui_register.g.ts`——不是 `import.meta.glob`：模板宿主不该绑死构建工具，
   * 而 glob 会把 `src/ui/` 下的文件全部静态拉进包，删了 UI 忘删文件它就还在。
   */
  mountsContainer?: HTMLElement | null;
  /**
   * 「名字 → UI 工厂」表（可选）：缺省空表，即 `mount` 只改状态、没有组件出现。
   *
   * 表由组合根从生成物取（`./mounts` 是那份生成物在 `src/**` 里的唯一引用点）：
   * 各框架形态的 UI 是组件对象、原生形态是工厂函数，所以这张表**由形态自己给**，
   * 宿主只负责把它的项挂进容器。
   */
  mountsTable?: Readonly<Record<string, unknown>>;
  /**
   * 自己接管 UI 挂载的落法（可选）：给了就不建原生渲染器，只把 `SYS.mounts` 的每个新值
   * 交给它。框架形态用这条——挂载点的父子关系归框架管，宿主再往同一个容器里写子节点
   * 会与框架的渲染树打架。
   *
   * 与 `mountsContainer` 互斥，容器优先。两样都不给即 `mount` 命令只改状态。
   */
  onMounts?: (raw: unknown) => void;
  /**
   * 自己接管启动界面的落法（可选）：给了就不由宿主造节点，只把屏幕态交给它。
   *
   * 框架形态用这条——启动界面是渲染树上的组件，宿主再往同一个根节点写子节点
   * 会与框架的渲染树打架。与原生形态互斥：不给则由宿主按 `#stage-root` 下的一层
   * 不透明覆盖物落 DOM，并在其在场时把舞台各层置为 `inert`。
   *
   * 两样都不给会抛——「既不画也不说」等于启动界面凭空消失，那是缺陷不是降级。
   */
  onScreen?: (view: ScreenView) => void;
}

/**
 * 端口覆盖表：换平台形态时由组合根传入原生实现，装配顺序与接线一行不改。
 * 各端口都可单独覆盖——缺哪一个就用该端口的 Web 形态。
 */
export interface BootPortOverrides {
  /** 工程文件供给（缺省走 fetch 取资源根下的静态文件） */
  files?: ProjectFilesPort;
  /** 资源 URL 解析（缺省走 WebView 源根静态资源） */
  resources?: ResourcePort;
  /** 存档（桌面壳换成 Rust 命令：WebView 的 localStorage 会被清缓存带走） */
  saves?: SavePort;
  /** 玩家偏好持久化（缺省走 localStorage；桌面壳换 app_data JSON 文件） */
  preferences?: PreferencesPort;
}

/**
 * 宿主句柄：装配完成后交给组合根的那几样东西。
 *
 * **为什么交出引擎**：组合根常需要在装配之外读引擎（调试面板、外部玩法系统、
 * 宿主自己的页面切换），而引擎是 `bootHost` 的内部变量。让调用方自己 `new StoryEngine`
 * 等于起第二个引擎，两个引擎订阅同一份存档端口必然互相踩。这里交出**同一个实例**。
 *
 * **为什么句柄可省**：现有组合根写的是 `void bootHost(...)` / `await bootHost(...)`，
 * 不取返回值——返回类型从 `void` 变成句柄不会破坏它们，它们照旧不关心句柄。
 * 需要句柄的宿主自己接住返回值即可。
 *
 * `preferences`：本宿主总是接线偏好层（缺省 localStorage，桌面壳经 `ports.preferences`
 * 换成 app_data 文件），所以句柄里恒定有它——调用方不需要判空。偏好不进存档，
 * 整局稳定，宿主的设置页直接读写这个实例即可。
 */
export interface HostHandle {
  /**
   * 引擎实例（与宿主内部订阅的是同一个）。
   *
   * `readonly`：宿主另建一个实例顶替它，两个引擎订阅同一份存档端口必然互相踩。
   * 句柄交出的是**那一个**实例，不可替换。
   */
  readonly engine: StoryEngine;
  /** 玩家偏好（已 hydrate；读写与订阅都走它）。同为 `readonly`：换实例等于丢掉既有订阅 */
  readonly preferences: PlayerPreferences;
  /**
   * 拆除本宿主：按依赖反序释放渲染器，再销毁引擎。
   *
   * 顺序是约束：渲染器订阅引擎状态，先拆引擎会让订阅回调打到已销毁的实例上。
   * 幂等——重复调用只生效第一次（渲染器的 `dispose` 自身也幂等）。
   */
  dispose(): void;
}

/**
 * 装配并启动本宿主。失败时抛出（组合根负责把失败写进页面），
 * 中途失败不会留下半启动的宿主：所有接线都在本函数内完成，抛出即放弃。
 *
 * 返回值是宿主句柄（见 {@link HostHandle}）；不需要句柄的调用方照旧忽略即可。
 */
export async function bootHost(options: HostBootOptions): Promise<HostHandle> {
  const { dom } = options;

  // 字体装配（纯展示，boot 一次性）：@font-face 注入 + 项目默认字体主题面，
  // 先于一切视图建立——首个对话帧渲染时 CSS 变量已就位
  installStoryFonts();

  // —— 工程文件：清单与故事同走 ProjectFilesPort（组装归引擎纯函数，宿主不预解析）——
  const filesPort: ProjectFilesPort =
    options.ports?.files ??
    createFetchProjectFilesPort({
      manifest: options.manifestFile,
      stories: options.stories,
    });
  const manifest: unknown = await filesPort.manifest();
  const story: Story = await loadProject(filesPort);

  // —— 适配器装配（Web 形态为缺省；原生形态经 ports 换掉资源与存档，契约不变）——
  const reportError = createErrorReporter(dom);
  const resourcePort: ResourcePort =
    options.ports?.resources ?? createStaticResourcePort();
  const audioPort: AudioPort = createWebAudioPort({ onError: reportError });
  const savePort: SavePort = options.ports?.saves ?? createWebStorageSavePort();

  // —— 玩家偏好：独立于存档的整局设置（音量 / 静音 / 字速）——
  // hydrate 失败 = 默认值起航（端口实现负责吞掉畸形数据，绝不因偏好坏掉挡住启动）
  const preferences = new PlayerPreferences(
    options.ports?.preferences ?? createWebStoragePreferencesPort(),
  );
  await preferences.hydrate();

  // —— 层级（z 序）：内建默认 × 工程覆盖（project.json 的 shell.layers）——
  const layerZ = resolveLayerZ(manifest);
  // 视频端口的 z 在端口内部（与 DOM 层不同），故端口晚于首次落 DOM 建立，
  // 由 getter 交给层级视图按需下发。
  let videoPort: VideoPort | null = null;
  const layers = createHostLayerZ({
    dom,
    layerZ,
    readVideoPort: () => videoPort,
  });
  layers.apply();

  videoPort = createWebVideoPort({
    onError: reportError,
    zIndex: layerZ.video,
  });

  // —— 存档壳配置：槽位（project.json 的 shell.saves.slots 可覆盖）——
  fillSaveSlots(dom, manifest);

  // 工程默认音量：shell.audio.volumes 是音量的第二级（命令没写 volume 时取它），
  // 玩家偏好仍是最外层乘算——两者不同层，缺了它「工程统一音量」就只能靠每条命令手写。
  const engine = new StoryEngine(story, {
    historyLimit: 200,
    savePort,
    audioConfig: resolveAudioConfig(manifest),
  });
  const audio = createAudioRenderer(engine, audioPort, resourcePort, {
    onError: reportError,
    // 偏好接线：通道音量 = op 音量 × 通道偏好，偏好变化即时重规划（不重头播）
    preferences,
  });
  const video = createVideoRenderer(engine, videoPort, resourcePort, {
    onError: reportError,
    onVideoFinished: () => engine.videoFinished(), // 播放结束 → 引擎解除 video 等待
    preferences,
  });

  const toast = createToast({
    dom,
    durationMs: options.toastDurationMs ?? DEFAULT_TOAST_MS,
  });
  const dialogue = createDialogueView({
    dom,
    engine,
    defaultCps: options.defaultCps ?? DEFAULT_TEXT_CPS,
  });

  // —— UI 挂载：`SYS.mounts` → 容器的子节点（不给容器 = mount 只改状态）——
  // 容器与表都由组合根给：宿主不造节点，也不猜 UI 长什么样（原生是工厂、框架是组件）。
  // 隐藏即真卸载（不是 display:none）：组件自己的定时器、订阅、媒体元素随拆除一起停。
  // 框架形态自己接管落法（`onMounts`）：往框架管的容器里写子节点会与它的渲染树打架。
  const nativeMounts =
    options.onMounts !== undefined ||
    options.mountsContainer === undefined ||
    options.mountsContainer === null
      ? null
      : createNativeMountRenderer({
          container: options.mountsContainer,
          table: options.mountsTable ?? {},
          reportError,
        });
  const onMounts =
    options.onMounts ??
    (nativeMounts === null
      ? undefined
      : (raw: unknown) => nativeMounts.sync(raw));

  wireEngine({
    dom,
    engine,
    layers,
    dialogue,
    resources: resourcePort,
    toast,
    reportError,
    // 故事级打字机设置（`text_typewriter` 命令）；未设置时按默认字速走
    readTypingSetting: () =>
      engine.get(SYS.typewriter) as TypingSetting | undefined,
    // 读档后媒体位置需显式对齐：引擎只回状态，播放位置由渲染器自己同步
    syncMedia: () => {
      audio.sync();
      video.sync();
    },
    // 元素回写落点：音量走偏好、玩法状态走 game. 命名空间（都经既有闸门）
    preferences,
    gameState: engine.gameState,
    // UI 挂载落点：没容器也不接管就不订阅（`mount` 命令照常改状态，只是没有组件出现）
    mounts: onMounts,
  });

  const driveEffects = createHostEffects({ dom, engine });

  // —— 偏好面板：只有组合根给了容器才装（页面结构归组合根，宿主不造节点）——
  // 面板只读写偏好层，不碰引擎与存档；`destroy` 在拆除时退订并清空容器。
  const prefsPanel =
    options.prefsContainer === undefined || options.prefsContainer === null
      ? null
      : createPreferencesPanel({
          preferences,
          container: options.prefsContainer,
        });
  prefsPanel?.mount();

  const frameLoop = startHostFrameLoop({
    dialogue,
    onMediaTick: () => audio.pollPosition(), // 媒体位置帧级回写
    onFrame: driveEffects,
  });
  // —— 屏幕切换：进游戏前画启动界面，进列后还舞台 ——
  // 判据是本列的类型而不是某个列名白名单：引擎不认识「启动界面」，它只说自己在哪列。
  // 框架形态给 `onScreen` 自己画；不给就由本文件按原生形态造节点挂到舞台根下。
  const screenSwitch = createScreenSwitch({
    engine,
    manifest,
    // 入口列来自故事本身：写死名字换个工程就指到不存在的列
    entry: story.entry,
    savePort,
    reportError,
    dom: options.onScreen === undefined ? dom : undefined,
    onView: options.onScreen,
  });
  wireInput({ dom, engine, dialogue });
  wireSaveSlots(dom, engine);

  engine.start();

  // 拆除顺序与装配相反：先停帧（不再有回调进来），再释放订阅引擎的渲染器，最后销毁引擎
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    frameLoop.stop();
    // UI 先拆：它可能持有自己那套框架实例或定时器，晚拆会让卸载跑在引擎销毁之后
    nativeMounts?.dispose();
    // 屏幕先拆：它订阅当前列，晚拆会让切屏跑在引擎销毁之后
    screenSwitch.dispose();
    // 面板先拆：它订阅偏好层，偏好 dispose 之后再退订会漏掉末次回填
    prefsPanel?.destroy();
    audio.dispose();
    video.dispose();
    engine.dispose();
    // 偏好最后收尾：补发防抖窗内未落盘的末次修改（引擎已停，没人再改它了）
    preferences.dispose();
  };

  return { engine, preferences, dispose };
}
