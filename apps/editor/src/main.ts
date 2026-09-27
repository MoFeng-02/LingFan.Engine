/**
 * 编辑器组合根（唯一全知位置，与 playground 同构）：装配**目录取径**的工程供给
 * → 引擎纯函数组装 → 把端口注入视图族。
 *
 * 取径（P2 编辑器工程模型）：
 * - 首选 = File System Access（`showDirectoryPicker`，Chromium）：真目录句柄，
 *   可枚举、可读、可写（保存时按需申请写权限）；
 * - 兜底 = 目录 input 的只读文件快照（`<input webkitdirectory>`，全浏览器）；
 * 两者都实现同一组端口契约（`packages/adapters` 的 `directorySource`），组件零感知。
 *
 * 未打开工程时 = 内存示例故事（现状语义不变：预览不解析资源、音频静音）。
 * 只支持**明文**工程：加密包（lfenpack 产物）需 Rust 解密，属 Tauri 壳后续。
 *
 * **写回（09-16）**：FSA 取径把「原始清单 + 打开基线 + writer」绑成 `save` 闭包交给界面；
 * 序列化（Story → 多文件工程）走引擎纯函数 `serializeProject`（格式知识单点）。
 */
import { createApp } from "vue";
import {
  createFileListFileSource,
  createHandleFileSource,
  createHandleProjectWriter,
  createSourceProjectFilesPort,
  createSourceResourcePort,
  createWebAudioPort,
  createWebVideoPort,
  loadProject,
  pickProjectDirectory,
  supportsDirectoryPicker,
  type ProjectFileSource,
} from "@lingfan/adapters";
import {
  DEFAULT_LAYER_Z,
  MANIFEST_FILE,
  resolveLayerZ,
  serializeProject,
  type AudioPort,
  type LayerZTable,
  type ProjectFilesPort,
  type ProjectWriteReport,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import App from "./App.vue";
import { sampleStory } from "./sample";
import type { OpenedProject, ProjectOpener } from "./ports";

/** 视频层 z（⑨-11 层级契约）：打开工程后按清单 `shell.layers` 解析，未打开 = 内建默认 */
let layerZ: LayerZTable = DEFAULT_LAYER_Z;

/** 只读取径（目录 input 快照）的保存提示——须说明怎么才能保存 */
const READONLY_SNAPSHOT_HINT =
  "当前是只读文件快照（目录 input 取径）：请用 Chrome/Edge 的「打开工程」选择目录以启用保存";

/** 供给源 + 端口 → 组装工程 + 资源端口（取径无关的唯一装载路径） */
async function loadFromSource(
  source: ProjectFileSource,
  filesPort: ProjectFilesPort,
): Promise<{ opened: OpenedProject; manifest: unknown }> {
  const manifest = await filesPort.manifest(); // 层级表要在引擎建起来前解析
  const story = await loadProject(filesPort); // 解析/组装归引擎纯函数（唯一解析点）
  layerZ = resolveLayerZ(manifest);
  return {
    opened: {
      root: source.name,
      story,
      resourcePort: createSourceResourcePort(source),
      layerZ: resolveLayerZ(manifest), // 随工程走：预览需要它解析实例级 z（08 §八.3）
    },
    manifest,
  };
}

const opener: ProjectOpener = {
  supportsPicker: supportsDirectoryPicker(),
  async pick(): Promise<OpenedProject | undefined> {
    const handle = await pickProjectDirectory();
    if (handle === undefined) return undefined; // 用户取消
    const source = await createHandleFileSource(handle);
    const filesPort = createSourceProjectFilesPort(source);
    const { opened, manifest } = await loadFromSource(source, filesPort);
    // 写回基线 = 打开时读到的原文（复用同一次装载的 memo，不额外枚举）
    const previous = new Map<string, string>([
      [MANIFEST_FILE, await source.text(MANIFEST_FILE)],
      ...(await filesPort.stories()),
    ]);
    const writer = await createHandleProjectWriter(handle, previous);
    return {
      ...opened,
      save: (next: Story): Promise<ProjectWriteReport> =>
        writer.apply(serializeProject(next, manifest).files),
    };
  },
  async fromFiles(files: readonly File[]): Promise<OpenedProject> {
    const source = await createFileListFileSource(files);
    const { opened } = await loadFromSource(
      source,
      createSourceProjectFilesPort(source),
    );
    // 快照取径无写权限：不给 save，只给提示（宿主据此禁用保存）
    return { ...opened, saveHint: READONLY_SNAPSHOT_HINT };
  },
};

createApp(App, {
  initialStory: sampleStory(),
  opener,
  // 媒体端口实例的创建归宿主（预览挂载才建，卸载即 dispose），实现在这里
  createAudioPort: (onError: (message: string) => void): AudioPort =>
    createWebAudioPort({ onError }),
  createVideoPort: (onError: (message: string) => void): VideoPort =>
    createWebVideoPort({ onError, zIndex: layerZ.video }),
}).mount("#app");