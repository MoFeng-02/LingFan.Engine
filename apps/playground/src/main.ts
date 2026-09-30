/**
 * 组合根（唯一全知位置）：装配平台适配器 → 加载组装工程 → 注入展示层。
 *
 * **平台装配是组合根的特权**（构建期插拔）：适配器按构建模式选择——
 * `--mode tauri`（Tauri 壳，Desktop/Mobile 双端）走原生实现，浏览器构建走纯 Web 实现；
 * 展示层与核心零改动。工程文件由 `ProjectFilesPort` 实现供给（Tauri = Rust 命令读资源根，
 * 浏览器 = fetch 静态根），组装是引擎纯函数；资源加密管线同理只换 ResourcePort。
 */
import { createApp, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  createWebAudioPort,
  createWebStoragePreferencesPort,
  createWebStorageSavePort,
  createWebVideoPort,
  connectWsBridge,
  createWsProjectFilesPort,
  createWsSavePort,
  createWsHostPlatform,
  loadProject,
  watchTauriProjectFiles,
} from "@lingfan/adapters";
import {
  PlayerPreferences,
  manifestOrientation,
  resolveLayerZ,
  resolveOrientationMode,
  resolveSavesConfig,
  type AudioPort,
  type HostInfo,
  type I18nPort,
  type LayerZTable,
  type OrientationMode,
  type OrientationPort,
  type PreferencesPort,
  type ProjectFilesPort,
  type ResourcePort,
  type SavePort,
  type SavesConfig,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import App from "./App.vue";

// 渲染诊断探针：`VITE_LFEN_DIAG=1` 构建时启用（iOS CI 白屏取证）；默认构建
// 动态 import 被 tree-shake，产物零增重。独立于 boot——白屏时 boot 可能挂，探针必须无条件跑。
if (import.meta.env.VITE_LFEN_DIAG === "1") {
  void import("./diag").then((module) => module.startDiag());
}

const MANIFEST = "project.json";
/**
 * 浏览器形态的故事清单（Tauri 形态由 Rust `project_files` 枚举目录，不用此表）。
 * **新增故事文件必须同步此处**——否则该列在浏览器形态不存在（跳转报 unknown-column）；
 * 防漂移由 `tests/playground/project.test.ts` 的「本表 ↔ 磁盘文件」互锁测试守护。
 */
const STORIES = [
  "Stories/start.json",
  "Stories/inn.json",
  "Stories/square.json",
  "Stories/end.json",
  "Stories/stage_demo.json",
];

async function boot(): Promise<void> {
  // —— 平台装配（构建期 + 运行期双层）——
  // 构建层：mode `tauri` 编译 Tauri 形态产物（含 invoke 路径）；纯浏览器构建编译 Web 形态。
  // 运行层：tauri 形态页面可能落在**外部浏览器**（tauri dev 时浏览器打开 localhost:1420）——
  // 此时无 `__TAURI_INTERNALS__`，invoke 不可用 ⇒ 升级走 WS dev 通道（宿主运行时），
  // 宿主未运行则回退 web 端口（尽力而为）。
  const isTauriWindow =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const useNative = import.meta.env.MODE === "tauri" && isTauriWindow;
  let filesPort: ProjectFilesPort;
  let savePort: SavePort;
  let wsPlatform: string | undefined;
  if (useNative) {
    filesPort = createTauriProjectFilesPort();
    savePort = createTauriSavePort();
  } else {
    filesPort = createFetchProjectFilesPort({ manifest: MANIFEST, stories: STORIES });
    savePort = createWebStorageSavePort();
    if (import.meta.env.DEV) {
      // WS dev 通道：宿主（tauri dev）运行时，外部浏览器经 WS 复用真实能力
      // （读工程/存档/平台——Rust 侧白名单最小暴露面）；宿主未运行 = 连接超时回退
      // 上方 web 端口（现状不变，尽力而为）。
      try {
        const bridge = await connectWsBridge({ timeoutMs: 1500 });
        filesPort = createWsProjectFilesPort(bridge);
        savePort = createWsSavePort(bridge);
        wsPlatform = await createWsHostPlatform(bridge);
        console.info("[lfen-ws] 浏览器已接入宿主 dev 通道（读工程/存档/平台）");
      } catch {
        console.info(
          "[lfen-ws] 宿主 WS 通道不可用，维持 web 端口（静态根 + webStorage）",
        );
      }
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
  const resourcePort: ResourcePort =
    useNative && encrypted
      ? createTauriEncryptedResourcePort()
      : createStaticResourcePort();
  // 层级（z 序）：内建默认 × 工程覆盖（project.json shell.layers）——层级不写死。
  // 视频适配器与舞台各层只消费解析结果（App 经 props 注入）。
  const layerZ: LayerZTable = resolveLayerZ(manifest);
  // 存档壳配置：槽位数与缩略图参数（project.json shell.saves 可覆盖）
  const saves: SavesConfig = resolveSavesConfig(manifest);
  const createAudioPort = (onError: (message: string) => void): AudioPort =>
    createWebAudioPort({ onError });
  const createVideoPort = (onError: (message: string) => void): VideoPort =>
    createWebVideoPort({ onError, zIndex: layerZ.video });
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
  // 只记诊断，不视作错误（apply 的「尽力而为」契约）。
  const orientationPort: OrientationPort =
    useNative
      ? createTauriOrientationPort()
      : createNoopOrientationPort();
  let appliedOrientation: OrientationMode | undefined;
  const applyOrientation = (): void => {
    const mode = resolveOrientationMode(
      preferences.orientation,
      manifestOrientation(manifest),
    );
    if (mode === appliedOrientation) return; // 其他偏好变化（音量/速度）不重复落壳
    appliedOrientation = mode;
    void orientationPort.apply(mode).then(
      (applied) => {
        if (!applied) console.info(`[orientation] ${mode} 未被当前平台应用`);
      },
      (error: unknown) => {
        console.error("[orientation] 应用失败：", error);
      },
    );
  };
  applyOrientation();
  preferences.onChange(applyOrientation);

  // 全屏偏好装配（与方向同模式：组合根落平台，偏好变化去重应用）。
  // 尽力而为契约：浏览器形态缺用户手势的启动期恢复会被 Fullscreen API 拒绝 =
  // 静默（偏好已持久化，下次有手势的切换生效）；Tauri 窗口命令无需手势。
  const fullscreenApplier =
    useNative
      ? createTauriFullscreenApplier(getCurrentWindow())
      : createBrowserFullscreenApplier();
  let appliedFullscreen = preferences.fullscreen ?? false;
  const applyFullscreen = (): void => {
    const on = preferences.fullscreen ?? false;
    if (on === appliedFullscreen) return; // 其他偏好变化（音量/速度/键位）不重复落窗
    appliedFullscreen = on;
    void fullscreenApplier.apply(on);
  };
  void fullscreenApplier.apply(appliedFullscreen); // 启动即恢复上次状态
  preferences.onChange(applyFullscreen);

  // ③ 平台区分（宿主信息）：取数来源 = Tauri CLI 注入的编译期平台（浏览器形态 undefined →
  // unknown·desktop，显式未知不猜）。宿主事实不可变，适配器内缓存；UI 只展示，按端分支后续按需加。
  const hostPort = createHostPort({
    platform: useNative ? await readTauriPlatform() : wsPlatform,
  });
  const host: HostInfo = hostPort.get();

  const app = createApp(App, {
    story,
    host,
    layerZ,
    saves,
    savePort,
    resourcePort,
    i18nPort,
    preferences,
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
