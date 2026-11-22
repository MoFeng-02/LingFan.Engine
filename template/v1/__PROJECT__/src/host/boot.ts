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
  DEFAULT_LANG,
  HOST_CAPABILITY_VALUES,
  PlayerPreferences,
  StoryEngine,
  manifestOrientation,
  resolveAudioConfig,
  resolveHistoryLimit,
  resolveLayerZ,
  resolveStageConfig,
  videoFitOf,
  type AudioPort,
  type HostControls,
  type I18nPort,
  type OrientationPort,
  type PersistentPort,
  type PreferencesPort,
  type ProjectFilesPort,
  type ResourcePort,
  type SavePort,
  type StageConfig,
  type Story,
  type VideoPort,
} from "@lingfan-engine/core";
import {
  createBrowserFullscreenApplier,
  createFetchProjectFilesPort,
  createFullscreenPolicy,
  createNoopOrientationPort,
  createOrientationPolicy,
  createStaticResourcePort,
  createWebAudioPort,
  createWebStoragePersistentPort,
  createWebStoragePreferencesPort,
  createWebStorageSavePort,
  createWebVideoPort,
  loadProject,
  type FullscreenApplier,
  type I18nLangEntry,
} from "@lingfan-engine/adapters";
import { createHostI18n, type HostI18n } from "@lingfan-engine/shell";
import {
  DEFAULT_TEXT_CPS,
  DEFAULT_TOAST_MS,
  applyDialogueAppearance,
  createAudioRenderer,
  createInputScopeState,
  createMinigameRegistry,
  createReducedMotionQuery,
  createVideoRenderer,
  type BodyView,
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
import { wireStageFit } from "./stage-fit";
import { wireInput } from "./input-map";
import { installStoryFonts, storyFontNames } from "./theme-fonts";
import { createPreferencesPanel } from "./panels/preferences";
import { createHistoryPanel } from "./panels/history";
import { createNativeMountRenderer } from "./mount/index";
import { wireBodyLayer } from "./stage-body";
import { createHostControls } from "./controls";
import { createHostI18nPort, wireHostI18n } from "./i18n";
import { templateExtensions } from "./extensions";
import { registerTemplateMinigames, templateMinigames } from "./minigame-demo";
import { createExtensionOverlay } from "./extension-overlay";
import { createTemplateDialogueTemplates } from "./dialogue-templates";
import { createResumePage } from "./resume-page";

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
  /**
   * 语言清单（可选）：构建期扫描 `Resources/Lang/` 的产物（`virtual:lang-list`）。
   * 缺省空清单 = 只有默认语言原文直出；给了则语言选择器与 `setLanguage` 按需取件。
   */
  langs?: readonly I18nLangEntry[];
  /** 故事未声明字速时的兜底（可见字符 / 秒）；缺省 = 展示层给出的默认字速 */
  defaultCps?: number;
  /** 提示条驻留毫秒数；缺省 = 展示层给出的默认时长 */
  toastDurationMs?: number;
  /** 舞台适配的显式覆盖（可选）：缺省时本文件按清单的 `shell.stage` 解析 */
  stage?: StageConfig;
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
   * 历史面板的挂载容器（可选）：给了就装配「已走过对话」的面板与回溯按钮，
   * 不给就不装——与 `prefsContainer` 同口径（页面结构归组合根，宿主不造节点）。
   *
   * 面板点一条即 `engine.rollbackTo(检查点)`；回溯后媒体位置由本文件接的
   * `onRollback` 显式对齐（引擎只回状态，不下发端口动作）。
   */
  historyContainer?: HTMLElement | null;
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
   * 列身体容器（可选）：给了就按 `SYS.body` 把 `src/scenes/` 下的身体组件渲染进来。
   *
   * 与 `mountsContainer` 同口径：容器由组合根提供并常驻（宿主不新建也不摘除它），
   * 身体表来自生成物 `src/gen/scene_register.g.ts`。一列一个身体，换列即整份重挂。
   */
  bodyContainer?: HTMLElement | null;
  /**
   * 「名字 → 身体组件」表（可选）：缺省空表，即 `body` 只改状态、没有组件出现。
   *
   * 表由组合根从生成物取（`./scenes` 是那份生成物在 `src/**` 里的唯一引用点）：
   * 各框架形态的身体是组件对象、原生形态是工厂函数，所以这张表**由形态自己给**。
   */
  scenesTable?: Readonly<Record<string, unknown>>;
  /**
   * 自己接管列身体的落法（可选）：给了就不建原生渲染器，只把选出的身体视图交给它。
   * 框架形态用这条——身体的父子关系归框架管。与 `bodyContainer` 互斥（给了回调走框架落法）。
   * 两样都不给即 `body` 命令只改状态。视图为 `null` 表示当前列没有身体。
   */
  onBody?: (view: BodyView | null) => void;
  /**
   * 取走宿主控制面（可选）：整局暂停与恢复、媒体暂停与恢复、换栏、存读档、拆除。
   *
   * 与 `onMounts` 是两条通道：挂载 UI 的**值**走 `SYS.mounts`（存档随行、必须 JSON 安全），
   * 操作**句柄**走这里（含函数、运行期注入、不进快照）。框架形态把它存进自己的容器
   * 再发给挂载组件；原生形态由渲染器直接作为工厂的第二参传下去，不需要这条回调。
   */
  onControls?: (controls: HostControls) => void;
  /**
   * 直达列 id（可选）：给了就跳过入口列，直接进这一列。
   *
   * 取值是列 id（不是文件名）。开发期由 `scripts/dev.mjs` 从命令行收来，
   * 经环境变量下发到组合根——宿主只认「要进哪一列」这一件事，不解析参数。
   *
   * 语义边界：入口列在跳转前已经执行过的部分（数值、角色声明、界面挂载）仍然生效，
   * 丢掉的只有入口列第一句台词及其之后的命令。
   */
  entry?: string;
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
  /** 机器级持久数据（已读记录等，跨存档共享；缺省 localStorage，桌面壳换 app_data JSON） */
  persistent?: PersistentPort;
  /**
   * 译文供给（缺省走 Web fetch：`Lang/` 是 publicDir 静态资源，桌面 WebView 同样可取）。
   * 桌面壳**不换**这个端口——Rust 侧未注册 i18n 命令，接 Tauri 端口会 invoke 失败。
   */
  i18n?: I18nPort;
  /**
   * 屏幕方向锁（缺省 noop：浏览器没有方向锁 API，应用了也不生效，只记诊断不报错）。
   * 桌面壳换成 Tauri 端口（经窗口命令尽力而为）。优先级与去重归策略闭包，端口只管应用。
   */
  orientationPort?: OrientationPort;
  /**
   * 全屏切换（缺省走浏览器 Fullscreen API：需用户手势，启动期那次通常被浏览器忽略，
   * 属平台限制不是错误）。桌面壳换成 Tauri 窗口命令。尽力而为，失败只记诊断。
   */
  fullscreenApplier?: FullscreenApplier;
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
   * 宿主语言门面（shell `createHostI18n` 的产物，绑同一个引擎实例）。
   *
   * `currentLang` / `availableLangs` 现读、`t()` 查表、`changeLang()` 切换、
   * `subscribe()` 订阅语言变更。页面语言选择器已由装配内部接好（`dom.lang` 给了的话）；
   * 需要代码切换或读当前语言的宿主用这个门面，不另建第二个。
   */
  readonly i18n: HostI18n;
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
  // 译文供给端口先于引擎（引擎构造要吃它，setLanguage 按需取件）。
  // 浏览器与桌面壳同走 Web fetch：Lang/ 是 publicDir 静态资源，WebView 同样可取。
  const i18nPort: I18nPort =
    options.ports?.i18n ?? createHostI18nPort(options.langs ?? []);

  // —— 玩家偏好：独立于存档的整局设置（音量 / 静音 / 字速）——
  // hydrate 失败 = 默认值起航（端口实现负责吞掉畸形数据，绝不因偏好坏掉挡住启动）
  const preferences = new PlayerPreferences(
    options.ports?.preferences ?? createWebStoragePreferencesPort(),
  );
  await preferences.hydrate();

  // —— 屏幕方向与全屏：偏好水合后立即应用，早于首帧内容绘制 ——
  // 优先级（玩家显式 > 工程 shell.orientation > auto）与同值去重都在策略闭包里，
  // 宿主只负责「启动应用一次 + 偏好变化再应用」。平台不支持时端口返回未生效，
  // 策略只记诊断不抛错——方向锁与全屏都是尽力而为，不该挡住启动。
  const applyOrientation = createOrientationPolicy({
    orientationPort:
      options.ports?.orientationPort ?? createNoopOrientationPort(),
    preference: () => preferences.orientation,
    manifestDefault: () => manifestOrientation(manifest),
  });
  applyOrientation();
  const offOrientation = preferences.onChange(applyOrientation);

  const fullscreenApplier =
    options.ports?.fullscreenApplier ?? createBrowserFullscreenApplier();
  const fullscreenPolicy = createFullscreenPolicy({
    applier: fullscreenApplier,
    preference: () => preferences.fullscreen,
  });
  // 启动那次按偏好初值应用（浏览器无手势会被忽略，属平台限制）；此后随偏好切换。
  void fullscreenApplier.apply(fullscreenPolicy.initial);
  const offFullscreen = preferences.onChange(() => fullscreenPolicy.apply());

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

  // 层级与几何无关，先写省一次布局抖动；引擎一启动即渲染首帧，适配必须在那之前落笔
  const stageFit = wireStageFit({
    dom,
    config: resolveStageConfig(manifest, options.stage),
  });
  videoPort = createWebVideoPort({
    onError: reportError,
    zIndex: layerZ.video,
    // 视频住震动层（与元素层同级，缩放已在父层生效）
    readContainer: () => dom.shake,
    // 填充读当前列的 video 元素：端口在挂载时才求值，换列或元素被替换后自动跟随；
    // 引擎在端口之后构造，闭包里晚绑定正是所需（提前求值会读到未初始化）。
    // 玩家默认填充槽（preferences.elementFit）只填作者没声明 stretch 的默认，op 显式赢。
    fit: () => videoFitOf(engine.elements(), preferences.elementFit),
  });

  // —— 存档壳配置：槽位（project.json 的 shell.saves.slots 可覆盖）——
  fillSaveSlots(dom, manifest);

  // 工程默认音量：shell.audio.volumes 是音量的第二级（命令没写 volume 时取它），
  // 玩家偏好仍是最外层乘算——两者不同层，缺了它「工程统一音量」就只能靠每条命令手写。
  // 小游戏注册表：宿主按名字取用工厂（渲染层不内建任何小游戏）；脚手架自带一个示例。
  const minigames = createMinigameRegistry();
  registerTemplateMinigames(minigames);
  const engine = new StoryEngine(story, {
    // 作者级历史容量（shell.historyLimit）；缺声明交引擎内建默认 200，非法值组装期已拒。
    historyLimit: resolveHistoryLimit(manifest),
    savePort,
    i18nPort,
    // 机器级持久数据端口（已读记录跨存档共享）；缺省 localStorage，桌面壳经 ports.persistent 换 Rust
    persistentPort:
      options.ports?.persistent ?? createWebStoragePersistentPort(),
    audioConfig: resolveAudioConfig(manifest),
    // 自定义 op 扩展与小游戏注册声明进引擎构造（注册期查重 / 进存档依赖标记）
    extensions: templateExtensions,
    minigames: templateMinigames,
  });
  // 机器级持久数据水合（已读记录）：独立于偏好/存档，损坏隔离不挡启动；与偏好水合同口径
  await engine.hydratePersistent();
  // 语言门面绑同一个引擎实例：t() 查表、changeLang() 切换、subscribe() 订阅语言变更。
  // 静态文案的查表函数交给各视图（缺省恒等 = 原文直出，不接 i18n 行为不变）。
  const i18n = createHostI18n(engine, { i18nPort });
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
    preferences,
    // 对话框模板：bubble 默认 + 示例 center；模板名三级优先级由核心解析，未知名回退默认
    templates: createTemplateDialogueTemplates(),
    translate: i18n.t,
  });

  // 对话框外观偏好 → CSS 变量投影（透明度/字号/高度/位置）：装配即投一次，
  // 偏好改动即时重投（设置面板滑杆 live）；变量名以展示层导出的常量为单一声明。
  const stopDialogueAppearance = applyDialogueAppearance(
    dom.dialogue,
    preferences,
  );

  // 扩展等待覆盖层：`extension.mount` 的「确认即解除」画面，住宿主 UI 层（窗口像素）。
  // 展示态编排共用展示层一份；这里只把它画进容器，确认经引擎解除等待。
  const extensionMount = createExtensionOverlay({
    container: dom.shellUi,
    resolveExtensionOp: (op, result) => engine.resolveExtensionOp(op, result),
    translate: i18n.t,
  });

  // —— 宿主控制面：引擎与媒体端口就绪后造一次，交出去（挂载 UI 与宿主菜单共用）——
  // 取用函数每次都读当下实例：`videoPort` 在层级建立后才赋值，故先收窄成常量再交出。
  const videoReady: VideoPort = videoPort;
  const controls = createHostControls({
    engine: () => engine,
    audio: () => audioPort,
    video: () => videoReady,
  });
  options.onControls?.(controls);

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
          // 值走 props、操作走 controls：原生形态没有响应式系统，工厂直接收下这两样
          controls,
          reportError,
        });
  const onMounts =
    options.onMounts ??
    (nativeMounts === null
      ? undefined
      : (raw: unknown) => nativeMounts.sync(raw));

  // —— 列身体：`SYS.body` → 这一屏渲染谁（不给容器也不接管 = body 只改状态）——
  // 选择与环境在展示层的身体层（三形态共用）；本处只装配。舞台几何经适配层读面注入，
  // 组件不自己监听 resize。框架形态自己接管落法（`onBody`），原生形态单槽整份重挂。
  const body = wireBodyLayer({
    getEngine: () => engine,
    readStage: () => stageFit.readStage(),
    table: options.scenesTable ?? {},
    controls,
    reportError,
    container: options.bodyContainer,
    onBody: options.onBody,
    // 桌面/浏览器宿主各能力通道齐全（mount/body/视频/音频/存档/文案都有落法）：声明全量，
    // 身体组件声明的所需能力在此恒满足，能力比对不会误伤既有组件（合法输入结果不变）。
    hostCapabilities: HOST_CAPABILITY_VALUES,
  });

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
    // 列身体渲染入口：没容器也不接管就不订阅（`body` 照常改状态，只是没有组件出现）
    body: body === null ? undefined : (): void => body.render(),
    // 小游戏注册表与扩展等待覆盖层：`minigame.mount` / `extension.mount` 的落点
    minigames,
    extensionMount,
    // 存读档回执前缀走查表（宿主字面量）；notify 正文与诊断不在此二次查表
    translate: i18n.t,
    // 写档成功：续玩入口重算可续槽位（槽位变多，「继续」要能点到新的档）
    onSaveDone: () => {
      void resumePage?.refresh();
    },
  });

  // 系统「减弱动效」测量：玩家未显式设置时跟随系统媒体查询（三态合成在表现层）。
  // 测量与订阅收尾归本组合根（dispose 拆除），表现层只逐帧现读有效值。
  const reducedMotionQuery = createReducedMotionQuery();
  const driveEffects = createHostEffects({
    dom,
    engine,
    preferences,
    readSystemReducedMotion: () => reducedMotionQuery.matches(),
  });

  // —— 偏好面板：只有组合根给了容器才装（页面结构归组合根，宿主不造节点）——
  // 面板只读写偏好层，不碰引擎与存档；`destroy` 在拆除时退订并清空容器。
  const prefsPanel =
    options.prefsContainer === undefined || options.prefsContainer === null
      ? null
      : createPreferencesPanel({
          preferences,
          container: options.prefsContainer,
          translate: i18n.t,
          fontNames: storyFontNames(),
        });
  prefsPanel?.mount();

  // —— 历史面板：同样只有组合根给了容器才装 ——
  // 数据整形在 `@lingfan-engine/shell`（块聚合），本面板只管画与点击；回溯后的媒体
  // 对齐交回这里——`wireEngine` 的 `syncMedia` 同一件事，引擎不会替宿主跳播放位置。
  const historyPanel =
    options.historyContainer === undefined || options.historyContainer === null
      ? null
      : createHistoryPanel({
          engine,
          container: options.historyContainer,
          onRollback: () => {
            audio.sync();
            video.sync();
          },
          translate: i18n.t,
        });
  historyPanel?.mount();

  // —— 语言接线：选择器 + 宿主静态文案重画（门面与视图都已就绪）——
  // 故事内容的重译由引擎派生键自动出站，这里只管宿主自己的字面量。
  const i18nWiring = wireHostI18n({
    dom,
    i18n,
    i18nPort,
    dialogue,
    prefsPanel: prefsPanel ?? undefined,
    historyPanel: historyPanel ?? undefined,
    preferences,
  });

  const frameLoop = startHostFrameLoop({
    dialogue,
    onMediaTick: () => audio.pollPosition(), // 媒体位置帧级回写
    onFrame: driveEffects,
  });
  const slotActions = wireSaveSlots(dom, engine, manifest);
  // 续玩入口：页面给了「继续」按钮才装（读最近一档接着玩）；写档成功后重算可续槽位。
  const resumePage =
    dom.continue === undefined || dom.continue === null
      ? null
      : createResumePage({
          button: dom.continue,
          savePort,
          manifest,
          load: (slot) => {
            engine.load(slot);
          },
        });
  const inputScope = createInputScopeState();
  const disposeInput = wireInput({
    dom,
    engine,
    dialogue,
    preferences,
    inputScope,
    onHistory: () => historyPanel?.toggle(),
    onClosePanels: () => historyPanel?.close(),
    onQuickSave: slotActions.save,
    onQuickLoad: slotActions.load,
  });

  engine.start();
  // 语言会话启动种子：新会话按玩家偏好语言起播；偏好只是种子，读档时档内
  // 语言会覆盖它（存档语言赢，见 load.done 重建）。默认语言不播种子（原文直出）。
  const seedLang = preferences.language;
  if (seedLang !== undefined && seedLang !== "" && seedLang !== DEFAULT_LANG) {
    void i18n.changeLang(seedLang).catch(() => undefined);
  }
  // 启动即刷新可续槽位：有旧档「继续」就能点，没有则禁用（不阻断启动）
  void resumePage?.refresh();

  // 直达：入口列已经跑过（数值、角色、界面挂载这些副作用仍在），再跳到目标列。
  // 引擎的 navigate 不经过流程控制命令，因此目标列的第一句话就是第一句台词。
  if (options.entry !== undefined && options.entry !== "") {
    engine.navigate(options.entry);
  }

  // 拆除顺序与装配相反：先停帧（不再有回调进来），再摘窗口监听与订阅引擎的渲染器，
  // 最后销毁引擎；监听不摘，宿主在同一页面被重建时就是重复落笔
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    frameLoop.stop();
    stageFit.dispose();
    // 输入监听与窗口监听同口径早退：拆除后不再把按键 / 点击翻译成引擎动作
    disposeInput();
    // 续玩入口退订点击（拆除后不再读档）
    resumePage?.dispose();
    // UI 先拆：它可能持有自己那套框架实例或定时器，晚拆会让卸载跑在引擎销毁之后
    nativeMounts?.dispose();
    // 身体同口径先拆：组件自己的订阅与局部状态随拆除钩子停掉
    body?.dispose();
    // 扩展等待覆盖层撤销中止订阅（展示态随引擎销毁清空，不再回填）
    extensionMount.abort();
    // 对话视图也订阅偏好（字速滑杆即时生效），与面板同口径先于偏好拆除退订
    dialogue.dispose();
    // 对话框外观投影同样订阅偏好，先于偏好拆除退订
    stopDialogueAppearance();
    // 系统减弱动效媒体监听收尾（拆除后不再读系统设置）
    reducedMotionQuery.dispose();
    // 方向与全屏策略也订阅偏好，先于偏好拆除退订（拆除后不再往平台落笔）
    offOrientation();
    offFullscreen();
    // 面板先拆：它订阅偏好层，偏好 dispose 之后再退订会漏掉末次回填
    prefsPanel?.destroy();
    historyPanel?.destroy();
    // 语言接线先于渲染器拆：退订门面与选择器事件，切语言回调不再打到将死的视图
    i18nWiring.dispose();
    audio.dispose();
    video.dispose();
    engine.dispose();
    // 偏好最后收尾：补发防抖窗内未落盘的末次修改（引擎已停，没人再改它了）
    preferences.dispose();
  };

  return { engine, preferences, i18n, dispose };
}
