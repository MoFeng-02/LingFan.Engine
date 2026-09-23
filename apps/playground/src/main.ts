/**
 * 组合根（唯一全知位置）：装配平台适配器 → 加载组装工程 → 注入展示层。
 *
 * **平台装配是组合根的特权**（rules §3.3 构建期插拔 / §5）：适配器按构建模式选择——
 * `--mode tauri`（Tauri 壳，Desktop/Mobile 双端）走原生实现，浏览器构建走纯 Web 实现；
 * 展示层与核心零改动。工程文件由 `ProjectFilesPort` 实现供给（Tauri = Rust 命令读资源根，
 * 浏览器 = fetch 静态根），组装是引擎纯函数；资源加密管线同理只换 ResourcePort。
 */
import { createApp, ref } from "vue";
import {
  createFetchProjectFilesPort,
  createStaticResourcePort,
  createTauriEncryptedResourcePort,
  createTauriProjectFilesPort,
  createTauriSavePort,
  createWebAudioPort,
  createWebStorageSavePort,
  createWebVideoPort,
  loadProject,
  watchTauriProjectFiles,
} from "@lingfan/adapters";
import type {
  AudioPort,
  ProjectFilesPort,
  ResourcePort,
  SavePort,
  Story,
  VideoPort,
} from "@lingfan/engine";
import App from "./App.vue";

const MANIFEST = "project.json";
const STORIES = [
  "Stories/start.json",
  "Stories/inn.json",
  "Stories/square.json",
  "Stories/end.json",
];

async function boot(): Promise<void> {
  // —— 平台装配（rules §3.3：构建/部署期插拔是默认能力）——
  // mode `tauri` = Tauri 壳（Desktop 与 Mobile 同契约：invoke/资源协议跨端一致）；
  // 其余 = 纯浏览器。原生与 Web 实现都只在此处选择，展示层与核心零感知。
  const filesPort: ProjectFilesPort =
    import.meta.env.MODE === "tauri"
      ? createTauriProjectFilesPort()
      : createFetchProjectFilesPort({ manifest: MANIFEST, stories: STORIES });
  // ref 包装：热重载重新组装后注入新 Story（App watch → engine.reloadStory）
  const story = ref<Story>(await loadProject(filesPort));

  // 05 §二 资源加密装配：清单声明 resourceEncryption（恒明文）→ Tauri 形态换加密
  // ResourcePort（Rust 解密 → Blob URL，契约不变）；否则静态根（未加密开发形态）。
  const manifest = await filesPort.manifest();
  const encrypted =
    (manifest as { resourceEncryption?: unknown } | null)
      ?.resourceEncryption === true;
  const savePort: SavePort =
    import.meta.env.MODE === "tauri"
      ? createTauriSavePort()
      : createWebStorageSavePort();
  const resourcePort: ResourcePort =
    import.meta.env.MODE === "tauri" && encrypted
      ? createTauriEncryptedResourcePort()
      : createStaticResourcePort();
  const createAudioPort = (onError: (message: string) => void): AudioPort =>
    createWebAudioPort({ onError });
  const createVideoPort = (onError: (message: string) => void): VideoPort =>
    createWebVideoPort({ onError });

  const app = createApp(App, {
    story,
    savePort,
    resourcePort,
    createAudioPort,
    createVideoPort,
  });
  app.mount("#app");

  // —— 07 §三.2 热重载（dev 工具，Tauri 形态）：Rust 监视源资源根（防抖）→ story-changed ——
  // → 重新供给+组装（每次新建端口绕过装载 memo）→ 新 Story 注入 props；
  // App watch → engine.reloadStory（保变量/历史，当前列重入）。浏览器形态无 fs 监视
  // 能力，dev 依赖 Vite 全页刷新兜底。
  if (import.meta.env.MODE === "tauri" && import.meta.env.DEV) {
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
