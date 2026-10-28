/**
 * 组合根（唯一全知位置：装配适配器 → 加载组装工程 → 建引擎 → 挂载展示层）。
 *
 * 本宿主**不依赖任何 UI 框架**——这是「引擎框架无关」的活证明：渲染直接操作 DOM，
 * 换成 Vue / React / 其他只改本文件与 index.html，引擎与适配器零改动。
 * 形态：**纯 Web**（vite 静态根 `Resources/`）——Tauri 壳的装配（invoke / 资源加密 /
 * 方向锁定 / 宿主信息 / 热重载）见引擎仓库 `apps/playground` 的组合根。
 *
 * 本文件只做三件事，实现都在 `host/` 里：
 *   1. 解析页面节点（`must` 调用点集中在此，与 index.html 的 id 互锁一眼可见）；
 *   2. 声明本工程的清单与故事表（可配置项的取值来源）；
 *   3. 调用 `bootHost` 装配并启动，失败写进页面。
 *
 * 覆盖范围（本宿主**保证不卡死**：引擎能进入的每个等待态都有 UI 可推进）：
 *   dialogue / menu / input / wait / video / minigame（可见 fail-closed 提示）+
 *   舞台元素层 + 层级表（shell.layers）+ 存档（shell.saves.slots）。
 * 有意未做（属「少功能」而非「卡死」，见 README 边界表）：历史面板与回溯 UI、
 * 玩家偏好面板、I18N 供给、对话框模板注册、存档缩略图合成。
 */

import { DEFAULT_TEXT_CPS, DEFAULT_TOAST_MS } from "@lingfan-engine/ui";
import {
  bootHost,
  createPageRegistry,
  createTitlePage,
  must,
  optional,
  reportBootFailure,
  type PageRegistry,
  type StageDom,
} from "./host";
import { STORIES } from "./stories";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是 `project.json` / `Stories/**`。
 * 清单放在资源根内是有意为之——只有资源根内的文件才会进打包产物，dev 与 prod 同机制。
 * 故事表在 `./stories`（唯一出口，各形态共用），内容由构建期扫描资源根得出。
 */
const MANIFEST = "project.json";

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
  prefs: optional("#prefs"),
  // 页面容器槽位（可选）：本层不给就 null，所有列都按 op 渲染
  page: optional("#page"),
};

/**
 * 页面表：列 id → 整屏页面。
 *
 * 这是「用页面渲染界面列」的唯一接缝：引擎不认识页面，也不知道「标题页」是什么，
 * 它只是进了某一列，宿主就把那一列注册过的页面挂上去。未注册的列照常按 op 渲染
 * ——没有自定义界面是合理降级，不是错误。
 */
function createPages(): PageRegistry {
  const pages = createPageRegistry();
  pages.register(
    "title_main",
    createTitlePage({
      subtitle: "这一屏是原生 DOM 渲染的页面，不是 op 堆出来的",
    }),
  );
  return pages;
}

void bootHost({
  dom,
  manifestFile: MANIFEST,
  stories: STORIES,
  defaultCps: DEFAULT_TEXT_CPS,
  toastDurationMs: DEFAULT_TOAST_MS,
  // 偏好面板槽位：页面给了就装（`optional` 已消化「这层不给」的情况）
  prefsContainer: dom.prefs,
  // 整屏界面槽位：给了就按列 id 挂页面，不给就整列按 op 渲染
  pageContainer: dom.page,
  pages: createPages(),
}).catch((error: unknown) => {
  reportBootFailure(dom, error);
});
