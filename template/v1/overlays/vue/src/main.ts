/**
 * 组合根（Vue 形态）：装配适配器 → 加载组装工程 → 建引擎 → 挂载展示层。
 *
 * 与骨架的差别只有「谁渲染页面结构」：这里先 `createApp(App).mount("#app")`，
 * 再读节点句柄——引擎要的 15 个节点由 `App.vue` 渲染出来，挂载前 `must` 只会抛。
 * 骨架的 `src/host/` 一行未改：它操作的是 `StageDom` 句柄表，不认识 Vue。
 *
 * 页面的层结构在 `src/App.vue`，样式在 `src/styles/stage.css`（两者都来自模板骨架，
 * 本层只替换入口与组合根）。
 */
import { createApp } from "vue";
import { DEFAULT_TEXT_CPS, DEFAULT_TOAST_MS } from "@lingfan-engine/ui";
import { bootHost, must, reportBootFailure, type StageDom } from "./host";
import { STORIES } from "./stories";
import App from "./App.vue";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是 `project.json` / `Stories/**`。
 * 故事表在 `./stories`（唯一出口，各形态共用），内容由构建期扫描资源根得出。
 */
const MANIFEST = "project.json";

/** 页面节点句柄表：每个 id 都必须由 `App.vue` 渲染（缺一个 `must` 当场抛） */
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
  };
}

/** 挂载页面结构；失败（含节点缺失）写进页面错误条，不留白屏 */
function mountApp(): StageDom | undefined {
  try {
    createApp(App).mount("#app");
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
    manifestFile: MANIFEST,
    stories: STORIES,
    defaultCps: DEFAULT_TEXT_CPS,
    toastDurationMs: DEFAULT_TOAST_MS,
  }).catch((error: unknown) => {
    reportBootFailure(dom, error);
  });
}
