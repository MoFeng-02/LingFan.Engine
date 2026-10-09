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

import {
  DEFAULT_TEXT_CPS,
  DEFAULT_TOAST_MS,
} from "@lingfan/ui";
import {
  bootHost,
  must,
  reportBootFailure,
  type StageDom,
} from "./host";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是 `project.json` / `Stories/**`。
 * 清单放在资源根内是有意为之——只有资源根内的文件才会进打包产物，dev 与 prod 同机制。
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
}).catch((error: unknown) => {
  reportBootFailure(dom, error);
});
