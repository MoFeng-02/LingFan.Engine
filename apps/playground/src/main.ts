/**
 * 组合根（唯一全知位置）：装配平台适配器 → 加载组装工程 → 注入展示层。
 *
 * **平台装配是组合根的特权**（rules §3.3 构建期插拔 / §5）：适配器按构建模式选择——
 * `--mode tauri`（Tauri 壳，Desktop/Mobile 双端）走原生实现，浏览器构建走纯 Web 实现；
 * 展示层与核心零改动。工程文件由 `ProjectFilesPort` 实现（fetch）供给，组装是引擎纯函数；
 * 正式形态把该适配器换成 Rust 命令即可（资源加密管线同理换 ResourcePort）。
 */
import { createApp } from "vue";
import {
  createStaticResourcePort,
  createTauriSavePort,
  createWebAudioPort,
  createWebStorageSavePort,
  createWebVideoPort,
  loadProjectFromFetch,
} from "@lingfan/adapters";
import type {
  AudioPort,
  ResourcePort,
  SavePort,
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
  const story = await loadProjectFromFetch({
    manifest: MANIFEST,
    stories: STORIES,
  });

  // —— 平台装配（rules §3.3：构建/部署期插拔是默认能力）——
  // mode `tauri` = Tauri 壳（Desktop 与 Mobile 同契约：invoke/资源协议跨端一致）；
  // 其余 = 纯浏览器。原生与 Web 实现都只在此处选择，展示层与核心零感知。
  const savePort: SavePort =
    import.meta.env.MODE === "tauri"
      ? createTauriSavePort()
      : createWebStorageSavePort();
  const resourcePort: ResourcePort = createStaticResourcePort();
  const createAudioPort = (onError: (message: string) => void): AudioPort =>
    createWebAudioPort({ onError });
  const createVideoPort = (onError: (message: string) => void): VideoPort =>
    createWebVideoPort({ onError });

  createApp(App, {
    story,
    savePort,
    resourcePort,
    createAudioPort,
    createVideoPort,
  }).mount("#app");
}

void boot().catch((error: unknown) => {
  const root = document.querySelector("#app");
  if (root !== null) {
    root.textContent = `工程加载失败：${String(error)}`;
  }
  throw error;
});
