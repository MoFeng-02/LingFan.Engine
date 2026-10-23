/**
 * 组合根（桌面壳形态）：与骨架只差一处——把存档端口换成 Rust 实现。
 *
 * 为什么换存档：WebView 的 `localStorage` 落在系统给这个应用分配的 WebView 数据目录里，
 * 清缓存、换系统账户、重装都会带走存档；桌面工程的存档应当是可指路径上的文件。
 * 换法是把端口交给 `bootHost` 的 `ports.saves`，装配顺序与其余接线一行不改。
 *
 * 工程文件与资源**不换**：骨架的 `vite.config.ts` 把 `Resources/` 当静态根，
 * 打包时这些文件被复制进 `dist/`，所以打包后 `/project.json`、`/Stories/**`、
 * `/Audio/x.mp3` 仍按同一套路径取得到——桌面壳不需要为此多造一组 Rust 命令。
 *
 * 页面结构沿用骨架的 `index.html`（本层不带自己的），故节点解析与骨架同源。
 */
import { DEFAULT_TEXT_CPS, DEFAULT_TOAST_MS } from "@lingfan-engine/ui";
import { createTauriSavePort } from "@lingfan-engine/adapters";
import { bootHost, must, reportBootFailure, type StageDom } from "./host";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 打包后它们位于 `dist/` 顶层，路径与开发期一致。
 * **新增故事文件必须同步此表**（Web 形态按显式清单取文件）。
 */
const MANIFEST = "project.json";
/** 本工程的故事文件表（相对资源根；新增故事必须同步此表） */
const STORIES = ["Stories/title/title_main.story"];

/** 页面节点句柄表：每个 id 都必须存在于 index.html（缺一个 `must` 当场抛） */
const dom: StageDom = {
  root: must("#stage-root"),
  stage: must("#stage"),
  dialogue: must("#dialogue"),
  speaker: must("#speaker"),
  text: must("#text"),
  hint: must("#hint"),
  nvl: must("#nvl"),
  choices: must("#choices"),
  notifications: must("#notifications"),
  toolbar: must("#toolbar"),
  slot: must<HTMLSelectElement>("#slot"),
  save: must<HTMLButtonElement>("#save"),
  load: must<HTMLButtonElement>("#load"),
  transition: must("#transition"),
  error: must("#error"),
};

void bootHost({
  dom,
  manifestFile: MANIFEST,
  stories: STORIES,
  defaultCps: DEFAULT_TEXT_CPS,
  toastDurationMs: DEFAULT_TOAST_MS,
  ports: {
    // 存档落到应用数据目录的 saves/ 下，一槽一文件（加密与回档保护在 Rust 侧扩展）
    saves: createTauriSavePort(),
  },
}).catch((error: unknown) => {
  reportBootFailure(dom, error);
});
