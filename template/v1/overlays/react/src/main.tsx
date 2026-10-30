/**
 * 组合根（React 形态）：装配适配器 → 加载组装工程 → 建引擎 → 挂载展示层。
 *
 * 与骨架的差别只有「谁渲染页面结构」：这里先把 `App` 挂到 `#app`，再读节点句柄——
 * 引擎要的 15 个节点由 `App.tsx` 渲染出来，挂载前 `must` 只会抛。骨架的 `src/host/`
 * 一行未改：它操作的是 `StageDom` 句柄表，不认识 React。
 *
 * 页面的层结构在 `src/App.tsx`，样式在 `src/styles/stage.css`（两者都来自模板骨架，
 * 本层只替换入口与组合根）。
 */
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
import { mountStore } from "./mounts";
import { screenStore } from "./screen";
import { App } from "./App.tsx";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是清单名 / `Stories/**`。
 * 清单名取引擎契约里的 `MANIFEST_FILE`（组装、写回、定位资源根共用同一个声明）；
 * 故事表在 `./stories`（唯一出口，各形态共用），内容由构建期扫描资源根得出。
 */

/** 页面节点句柄表：每个 id 都必须由 `App.tsx` 渲染（缺一个 `must` 当场抛） */
function readDom(): StageDom {
  return {
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
    // 偏好面板槽位（可选）：本层 App 没给就 null，面板不装、游戏照跑
    prefs: optional("#prefs"),
    // UI 挂载层槽位（可选）：本层不给就 null，`mount` 命令只改状态、没有组件出现
    mounts: optional("#mounts"),
  };
}

/** 挂载页面结构；失败（含节点缺失）写进页面错误条，不留白屏 */
function mountApp(): StageDom | undefined {
  try {
    const container = document.querySelector("#app");
    if (container === null) throw new Error("宿主缺少节点：#app");
    // StrictMode 只影响开发期的重复渲染提示，不改变侧建行为：引擎在下面单独启动
    createRoot(container).render(
      createElement(StrictMode, null, createElement(App)),
    );
    return readDom();
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

const dom = mountApp();
if (dom !== undefined) {
  void bootHost({
    dom,
    manifestFile: MANIFEST_FILE,
    stories: STORIES,
    defaultCps: DEFAULT_TEXT_CPS,
    toastDurationMs: DEFAULT_TOAST_MS,
    prefsContainer: dom.prefs,
    // UI 挂载落法由 React 接管：`#mounts` 的子节点归 `UiHost` 渲染，
    // 宿主再往里写节点就会与 React 的渲染树打架（所以不传 mountsContainer）
    onMounts: (raw) => mountStore.set(raw),
    // 屏幕落法同样由 React 接管：启动界面是渲染树上的组件（`StartScreen`），
    // 交给宿主自己造节点会与 React 的渲染树打架（所以不传原生形态的落法）
    onScreen: (view) => screenStore.set(view),
  }).catch((error: unknown) => {
    reportBootFailure(dom, error);
  });
}
