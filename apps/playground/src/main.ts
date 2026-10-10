/**
 * 组合根（唯一全知位置）：装配平台适配器 → 加载组装工程 → 注入展示层。
 *
 * **平台装配是组合根的特权**（构建期插拔）：适配器按构建模式选择——
 * `--mode tauri`（Tauri 壳，Desktop/Mobile 双端）走原生实现，浏览器构建走纯 Web 实现；
 * 展示层与核心零改动。工程文件由 `ProjectFilesPort` 实现供给（Tauri = Rust 命令读资源根，
 * 浏览器 = fetch 静态根），组装是引擎纯函数；资源加密管线同理只换 ResourcePort。
 *
 * 可独立成面的策略（交付守卫、WS dev 通道、媒体端口装配、方向与全屏去重）在 `./boot`；
 * 这里留下装配顺序，以及必须同时看过构建形态、加密事实与宿主平台才能定的判定行。
 */
import { createApp, ref } from "vue";
import {
  createBrowserFullscreenApplier,
  createFetchProjectFilesPort,
  createHostPort,
  createNoopOrientationPort,
  createStaticResourcePort,
  createTauriEncryptedResourcePort,
  createTauriFullscreenApplier,
  createTauriI18nPort,
  readTauriPlatform,
  createTauriPreferencesPort,
  createTauriProjectFilesPort,
  createTauriOrientationPort,
  createTauriSavePort,
  createWebStoragePreferencesPort,
  createWebStorageSavePort,
  loadProject,
  watchTauriProjectFiles,
} from "@lingfan/adapters";
import {
  MANIFEST_FILE,
  PlayerPreferences,
  loadDeclaredExtensions,
  manifestOrientation,
  resolveLayerZ,
  resolveSavesConfig,
  type HostInfo,
  type I18nPort,
  type LayerZTable,
  type OpExtension,
  type OrientationPort,
  type PreferencesPort,
  type ProjectFilesPort,
  type ResourcePort,
  type SavePort,
  type SavesConfig,
  type Story,
} from "@lingfan/engine";
import demoQuestExtension from "../extensions/demo-quest";
import App from "./App.vue";
import {
  connectWsDevChannel,
  createFullscreenPolicy,
  createMediaPortFactories,
  createOrientationPolicy,
  detectTauriWindow,
  loadTauriWindow,
  MEDIA_BLOB_SOURCE_MAX_BYTES,
  renderBrowserBlocked,
} from "./boot";
import { browserPlayAllowed } from "./browserGuard";

// 渲染诊断探针：`VITE_LFEN_DIAG=1` 构建时启用（iOS CI 白屏取证）；默认构建
// 动态 import 被 tree-shake，产物零增重。独立于 boot——白屏时 boot 可能挂，探针必须无条件跑。
if (import.meta.env.VITE_LFEN_DIAG === "1") {
  void import("./diag").then((module) => module.startDiag());
}

/**
 * 浏览器形态的故事清单（Tauri 形态由 Rust `project_files` 枚举目录，不用此表）。
 * **新增故事文件必须同步此处**——否则该列在浏览器形态不存在（跳转报 unknown-column）；
 * 防漂移由 `tests/playground/project.test.ts` 的「本表 ↔ 磁盘文件」互锁测试守护。
 */
const STORIES = [
  "Stories/chapter1/chapter1.story",
  "Stories/chapter2/chapter2.story",
  "Stories/chapter3/chapter3.story",
  "Stories/chapter4/vocab_tour.story",
];

/** 入口引导：判定运行形态（构建期 mode + 运行期探测）→ 门禁 → 建引擎 → 挂载 UI；分层口径见函数内注释。 */
async function boot(): Promise<void> {
  // —— 平台装配（构建期 + 运行期双层）——
  // 构建层：mode `tauri` 编译 Tauri 形态产物（含 invoke 路径）；纯浏览器构建编译 Web 形态。
  // 运行层：tauri 形态页面可能落在**外部浏览器**（tauri dev 时浏览器打开 localhost:1420）——
  // 此时无 `__TAURI_INTERNALS__`，invoke 不可用 ⇒ 升级走 WS dev 通道（宿主运行时），
  // 宿主未运行则回退 web 端口（尽力而为）。
  const isTauriWindow = detectTauriWindow();
  const useNative = import.meta.env.MODE === "tauri" && isTauriWindow;
  // 浏览器游戏模式守卫：无壳 + 非开发模式 + 未显式声明浏览器游戏模式 ⇒ 拒绝（不外泄）。
  // 交付形态只应是 Tauri 壳；Web 供给面（静态根 + 明文资源）不得随交付物一同存在。
  if (!useNative && !browserPlayAllowed()) {
    renderBrowserBlocked();
    return;
  }
  let filesPort: ProjectFilesPort;
  let savePort: SavePort;
  let wsPlatform: string | undefined;
  if (useNative) {
    filesPort = createTauriProjectFilesPort();
    savePort = createTauriSavePort();
  } else {
    filesPort = createFetchProjectFilesPort({
      manifest: MANIFEST_FILE,
      stories: STORIES,
    });
    savePort = createWebStorageSavePort();
    if (import.meta.env.DEV) {
      // WS dev 通道：宿主（tauri dev）运行时，外部浏览器经 WS 复用真实能力
      // （读工程/存档/平台——Rust 侧白名单最小暴露面）；宿主未运行 = 连接超时回退
      // 上方 web 端口（现状不变，尽力而为）。
      await connectWsDevChannel({
        usePorts(files, saves) {
          filesPort = files;
          savePort = saves;
        },
        usePlatform(platform) {
          wsPlatform = platform;
        },
      });
    }
  }
  // ref 包装：热重载重新组装后注入新 Story（App watch → engine.reloadStory）
  const story = ref<Story>(await loadProject(filesPort));
  // 资源加密装配：清单声明 resourceEncryption（恒明文）→ Tauri 形态换加密
  // ResourcePort（Rust 解密 → Blob URL，契约不变）；否则静态根（未加密开发形态）。
  const manifest = await filesPort.manifest();
  const encrypted =
    (manifest as { resourceEncryption?: unknown } | null)
      ?.resourceEncryption === true;
  // 扩展装载（声明制）：清单 `extensions` 声明模块说明符；宿主以**静态打包表**解析
  // （vite 模块图编译期确定——说明符字符串是「声明 ↔ 宿主」的对齐点；构建期同一说明符
  // 已由 stories:build 做过放行校验）。声明缺席/为空 = 空数组且装载器零触发。
  const extensionModules: Record<string, { default: unknown }> = {
    "./extensions/demo-quest.ts": { default: demoQuestExtension },
  };
  const declaredExtensions = (manifest as { extensions?: unknown }).extensions;
  const extensions: OpExtension[] = await loadDeclaredExtensions(
    Array.isArray(declaredExtensions) ? (declaredExtensions as string[]) : [],
    async (specifier) => {
      const mod = extensionModules[specifier];
      if (mod === undefined) {
        throw new Error(`宿主未打包清单声明的扩展模块：${specifier}`);
      }
      return mod;
    },
  );
  const resourcePort: ResourcePort =
    useNative && encrypted
      ? createTauriEncryptedResourcePort()
      : createStaticResourcePort();
  // 层级（z 序）：内建默认 × 工程覆盖（project.json shell.layers）——层级不写死。
  // 视频适配器与舞台各层只消费解析结果（App 经 props 注入）。
  const layerZ: LayerZTable = resolveLayerZ(manifest);
  // 存档壳配置：槽位数与缩略图参数（project.json shell.saves 可覆盖）
  const saves: SavesConfig = resolveSavesConfig(manifest);
  // 平台区分（宿主信息）：取数来源 = Tauri CLI 注入的编译期平台（浏览器形态 undefined →
  // unknown·desktop，显式未知不猜）。宿主事实不可变，适配器内缓存；UI 只展示，按端分支后续按需加。
  // 置于媒体端口之前：媒体源物化的开关取决于宿主事实（见下）。
  const hostPort = createHostPort({
    platform: useNative ? await readTauriPlatform() : wsPlatform,
  });
  const host: HostInfo = hostPort.get();
  // 媒体源物化的开关：加密形态下媒体由自定义协议供给，而 Android WebView 对**带 `Range` 头**的
  // 拦截响应会在网络层直接失败（非零起点区间必错）——非 faststart 的 MP4 解复用必然读尾部，
  // 于是播放必坏。故只有该平台走「无 `Range` 取回全量 → Blob URL」的物化供给，其余平台保持直供
  // （Range 按需流式正常）。上限取值与两个媒体端口的装配见 `./boot`（`platform-policy`）。
  const mediaBlobSourceMaxBytes =
    useNative && encrypted && host.os === "android"
      ? MEDIA_BLOB_SOURCE_MAX_BYTES
      : undefined;
  const { createAudioPort, createVideoPort } = createMediaPortFactories({
    mediaBlobSourceMaxBytes,
    videoZIndex: layerZ.video,
  });
  // I18N 装配：Tauri 形态走 Rust overlay 供给（按需加载）；浏览器形态暂无
  // 静态根供给（未注入 = 原文直出，引擎契约缺省语义）
  const i18nPort: I18nPort | undefined =
    useNative ? createTauriI18nPort() : undefined;
  // 玩家偏好（与存档分离）：boot 时载入上次退出状态，滑块改动防抖落盘
  const preferencesPort: PreferencesPort =
    useNative
      ? createTauriPreferencesPort()
      : createWebStoragePreferencesPort();
  const preferences = new PlayerPreferences(preferencesPort);
  await preferences.hydrate();

  // 屏幕方向装配：工程默认（project.json shell.orientation）× 玩家偏好 →
  // 壳端口。**落壳归组合根**（组件不碰平台桥接）：启动即应用一次（早于内容绘制，
  // 尽量规避首帧先竖后横），此后订阅偏好变化实时应用。未生效（平台忽略/无壳形态）
  // 只记诊断，不视作错误（apply 的「尽力而为」契约）。去重状态在 `./boot` 的策略闭包内。
  const orientationPort: OrientationPort =
    useNative
      ? createTauriOrientationPort()
      : createNoopOrientationPort();
  const applyOrientation = createOrientationPolicy({
    orientationPort,
    preference: () => preferences.orientation,
    manifestDefault: () => manifestOrientation(manifest),
  });
  applyOrientation();
  preferences.onChange(applyOrientation);

  // 全屏偏好装配（与方向同模式：组合根落平台，偏好变化去重应用）。
  // 尽力而为契约：浏览器形态缺用户手势的启动期恢复会被 Fullscreen API 拒绝 =
  // 静默（偏好已持久化，下次有手势的切换生效）；Tauri 窗口命令无需手势。
  const fullscreenApplier = useNative
    ? createTauriFullscreenApplier(await loadTauriWindow())
    : createBrowserFullscreenApplier();
  const fullscreenPolicy = createFullscreenPolicy({
    applier: fullscreenApplier,
    preference: () => preferences.fullscreen,
  });
  const applyFullscreen = (): void => fullscreenPolicy.apply();
  void fullscreenApplier.apply(fullscreenPolicy.initial); // 启动即恢复上次状态
  preferences.onChange(applyFullscreen);

  const app = createApp(App, {
    story,
    host,
    layerZ,
    saves,
    savePort,
    resourcePort,
    i18nPort,
    preferences,
    extensions,
    createAudioPort,
    createVideoPort,
  });
  app.mount("#app");

  // —— 热重载（dev 工具，Tauri 窗口内）：Rust 监视源资源根（防抖）→ story-changed ——
  // → 重新供给+组装（每次新建端口绕过装载 memo）→ 新 Story 注入 props；
  // App watch → engine.reloadStory（保变量/历史，当前列重入）。浏览器形态无 fs 监视
  // 能力（外部浏览器亦无 listen API），dev 依赖 Vite 全页刷新兜底。
  if (useNative && import.meta.env.DEV) {
    void watchTauriProjectFiles(async () => {
      try {
        story.value = await loadProject(createTauriProjectFilesPort());
      } catch (error: unknown) {
        console.error("热重载组装失败：", error);
      }
    });
  }
}

void boot().catch((error: unknown) => {
  const root = document.querySelector("#app");
  if (root !== null) {
    root.textContent = `工程加载失败：${String(error)}`;
  }
  throw error;
});
