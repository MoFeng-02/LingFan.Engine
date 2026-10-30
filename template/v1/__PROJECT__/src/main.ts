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

import { MANIFEST_FILE } from "@lingfan-engine/core";
import { DEFAULT_TEXT_CPS, DEFAULT_TOAST_MS } from "@lingfan-engine/ui";
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
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是清单名 / `Stories/**`。
 * 清单放在资源根内是有意为之——只有资源根内的文件才会进打包产物，dev 与 prod 同机制。
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
  prefs: optional("#prefs"),
  // UI 挂载层槽位（可选）：本层不给就 null，`mount` 命令只改状态、没有组件出现
  mounts: optional("#mounts"),
};

void bootHost({
  dom,
  manifestFile: MANIFEST_FILE,
  stories: STORIES,
  defaultCps: DEFAULT_TEXT_CPS,
  toastDurationMs: DEFAULT_TOAST_MS,
  // 偏好面板槽位：页面给了就装（`optional` 已消化「这层不给」的情况）
  prefsContainer: dom.prefs,
  // UI 挂载槽位：给了就把 `mount` 命令控制显隐的组件挂进来
  mountsContainer: dom.mounts,
  // 「名字 → UI 工厂」表：来自生成物，键就是 `SYS.mounts` 里的名字
  mountsTable: uis,
}).catch((error: unknown) => {
  reportBootFailure(dom, error);
});
