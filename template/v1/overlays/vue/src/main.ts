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
import {
  bootHost,
  createPageRegistry,
  must,
  optional,
  reportBootFailure,
  type PageRegistry,
  type StageDom,
} from "./host";
import { STORIES } from "./stories";
import App from "./App.vue";
import TitlePage from "./pages/title-page.vue";

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
    // 偏好面板槽位（可选）：本层 App 没给就 null，面板不装、游戏照跑
    prefs: optional("#prefs"),
    // 页面容器槽位（可选）：本层不给就 null，所有列都按 op 渲染
    page: optional("#page"),
  };
}

/**
 * 页面表：列 id → 整屏页面。
 *
 * 这是「用框架渲染界面」的唯一接缝——注册表在宿主里，引擎不认识 Vue，
 * 也不知道「标题页」是什么；它只是进了某一列，宿主就把那一列注册过的页面挂上去。
 * 未注册的列照常按 op 渲染：没有自定义界面是合理降级，不是错误。
 */
function createPages(): PageRegistry {
  const pages = createPageRegistry();
  pages.register("title_main", (ctx) => {
    // 每次挂载都是新实例：切走时 `unmount` 会 `app.unmount()`，Vue 的响应式与
    // 事件监听随实例一起拆掉，不留在后台占内存。
    const app = createApp(TitlePage, { ctx });
    return {
      mount(container): void {
        app.mount(container);
      },
      unmount(): void {
        app.unmount();
      },
    };
  });
  return pages;
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
    prefsContainer: dom.prefs,
    // 整屏界面槽位：给了就按列 id 挂页面，不给就整列按 op 渲染
    pageContainer: dom.page,
    pages: createPages(),
  }).catch((error: unknown) => {
    reportBootFailure(dom, error);
  });
}
