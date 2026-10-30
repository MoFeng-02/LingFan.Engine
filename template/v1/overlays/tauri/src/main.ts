/**
 * 组合根（桌面壳形态）：与骨架只差两处——先装宿主桥，再把存档端口换成 Rust 实现。
 *
 * 为什么先装桥：`@lingfan-engine/adapters` 是给外部工程消费的源码包，包内不写
 * `@tauri-apps/api` 的模块名（写了会让纯 Web 形态在构建期解析失败，写成变量说明符又会在
 * 产物里残留裸模块名、WebView 执行时抛错）。模块名留在本文件这一层——本工程有这个依赖，
 * 且只在壳里跑到这里；`installTauriBridge` 把两个函数交给适配器，之后各端口工厂的
 * 缺省实现才可用。
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
import { MANIFEST_FILE } from "@lingfan-engine/core";
import { DEFAULT_TEXT_CPS, DEFAULT_TOAST_MS } from "@lingfan-engine/ui";
import {
  createTauriSavePort,
  installTauriBridge,
} from "@lingfan-engine/adapters";
import {
  bootHost,
  must,
  optional,
  reportBootFailure,
  type StageDom,
} from "./host";
import { STORIES } from "./stories";
import { uis } from "./mounts";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 打包后它们位于 `dist/` 顶层，路径与开发期一致。
 * 清单名取引擎契约里的 `MANIFEST_FILE`（组装、写回、定位资源根共用同一个声明）；
 * 故事表在 `./stories`（唯一出口，各形态共用），内容由构建期扫描资源根得出。
 */

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
  // 偏好面板槽位（可选）：骨架 index.html 里有，缺了也不影响启动
  prefs: optional("#prefs"),
  // UI 挂载层槽位（可选）：本层不给就 null，`mount` 命令只改状态、没有组件出现
  mounts: optional("#mounts"),
};

/**
 * 装配宿主桥并启动宿主。
 *
 * 静态说明符（不带 `@vite-ignore`）是刻意的：打包器据此把这两个模块打进产物，
 * 运行期不再需要解析裸模块名。
 */
async function boot(): Promise<void> {
  const [{ invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  installTauriBridge({ invoke, listen });

  await bootHost({
    dom,
    manifestFile: MANIFEST_FILE,
    stories: STORIES,
    defaultCps: DEFAULT_TEXT_CPS,
    toastDurationMs: DEFAULT_TOAST_MS,
    prefsContainer: dom.prefs,
    // UI 挂载槽位：壳层用骨架的原生渲染器（本层不引框架，`#mounts` 的子节点由宿主写）
    mountsContainer: dom.mounts,
    mountsTable: uis,
    ports: {
      // 存档落到应用数据目录的 saves/ 下，一槽一文件（加密与回档保护在 Rust 侧扩展）
      saves: createTauriSavePort(),
    },
  });
}

boot().catch((error: unknown) => {
  reportBootFailure(dom, error);
});
