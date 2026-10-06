<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import type { Ref } from "vue";
import type {
  AudioPort,
  DegradedOpen,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  VideoPort,
  WriteNormalizationFinding,
} from "@lingfan/engine";
import { DEFAULT_LAYER_Z } from "@lingfan/engine";
import {
  EditorSession,
  addColumn,
  addGroup,
  analyzeStory,
  assignColumn,
  createColumnGroupingStore,
  describeNormalization,
  elementLabel,
  emptyGroupingView,
  firstColumnIdOfSourcePath,
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  nearestCommandPointer,
  planBranchInsertion,
  pruneGroupingView,
  readSkipNormalizationNotice,
  removeAtPointer,
  removeColumn,
  removeGroup,
  renameColumn,
  renameColumnMember,
  renameGroup,
  setAtPointer,
  toggleCollapsed,
  writeSkipNormalizationNotice,
  type ColumnGroupingView,
  type KeyValueStorage,
} from "@lingfan/editor";
import { sampleStory } from "./sample";
import ColumnList from "./components/ColumnList.vue";
// 章节树 = 列列表的**升级**：把列按作者的目录编排分组（`Stories/chapter1/…` ⇒ 章节）
import ChapterTree from "./components/ChapterTree.vue";
import ComponentPalette from "./components/ComponentPalette.vue";
import StoryTimeline from "./components/StoryTimeline.vue";
import StageEditor from "./components/StageEditor.vue";
import PropertyPanel from "./components/PropertyPanel.vue";
import DiagnosticsPanel from "./components/DiagnosticsPanel.vue";
import JsonView from "./components/JsonView.vue";
import TextModeView from "./components/TextModeView.vue";
import NodeGraph from "./components/NodeGraph.vue";
import StepLayout from "./components/StepLayout.vue";
import PreviewHost from "./components/PreviewHost.vue";
import DialogHost from "./components/DialogHost.vue";
import LangWorkbench, { type LangSummary } from "./components/LangWorkbench.vue";
import PackPanel, { type PackRequest, type PackResult } from "./components/PackPanel.vue";
import EmptyState from "./components/EmptyState.vue";
import LangView from "./components/LangView.vue";
import JsonResourceView from "./components/JsonResourceView.vue";
import MediaView from "./components/MediaView.vue";
import PaneSplitter from "./components/PaneSplitter.vue";
import ReadOnlyView from "./components/ReadOnlyView.vue";
import ResourceTreeView from "./components/ResourceTreeView.vue";
import StatusBar from "./components/StatusBar.vue";
import { viewOfKind } from "./dispatch";
import { createDialogPort, DialogHostState } from "./dialog";
import { DIALOG_PORT_KEY } from "./dialogInjection";
import { decideAddColumn } from "./addColumnIntent";
import { detectLocalHost, fetchWatchStatus, pollWatch, type LocalHostEndpoint } from "./localHost";
import { extractStoryKeys, groupKeysByStory, planOverlaySkeleton, type SkeletonLayoutChoice } from "@lingfan/editor";
import { searchResources, type SearchCorpus } from "./search";
import type { EmptyAction } from "./viewState";

import {
  createLayoutStore,
  MAX_RIGHT_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_RIGHT_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type LayoutState,
} from "./layout";
import {
  buildResourceTree,
  kindOfPath,
  type ResourceKind,
  type ResourceNode,
} from "./resourceTree";
import {
  columnIdOfDocument,
  storyDocumentPath,
  Workspace,
  type EditorDocument,
} from "./workspace";
import type {
  LastProjectEntry,
  OpenedProject,
  ProjectOpener,
} from "./ports";

/**
 * 组合根注入（本组件不碰任何平台 API / 适配器）：
 * - `initialStory` = 未打开工程时的示例故事；
 * - `opener` = 「打开工程」取径（目录选择与文件读取都在 main.ts）；
 * - `lastProject` = 「记住上次工程」：句柄就绪后由组合根填充（ref）；
 * - 媒体端口工厂 = 视频层 z 等实现细节留在组合根。
 */
const props = defineProps<{
  /** 启动时的故事（未打开工程 = 内存示例；「打开工程」后由会话中枢换基线） */
  initialStory: Story;
  opener: ProjectOpener;
  /** 上次工程一键重开入口（IDB 异步就绪后填充；无 = 按钮不渲染）。ref 随 props 显式传递 */
  lastProject?: Ref<LastProjectEntry | undefined>;
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}>();

/** EditorSession = 视图族共享中枢（一处改动全视图同步 + 统一 undo） */
let session = new EditorSession(props.initialStory);
/**
 * 多文档中枢（资源管理器）：**一个资源 = 一个文档 = 一个会话**。
 *
 * 视图族零改动的接法：`session` 永远是**活动文档**的会话（下方 `bindActive` 重绑），
 * 13 个组件经 `provide("editorApi")` 消费的那份引用因此始终指向当前标签。
 * 标签切换 = 重绑 + 重投影状态，不触碰任何组件。
 */
const workspace = new Workspace();
workspace.open(storyDocumentPath(props.initialStory.entry), "story", props.initialStory);
/** 文档态（供标签栏渲染；空数组 = 无标签，界面据此走空态） */
const documentPaths = ref<string[]>([storyDocumentPath(props.initialStory.entry)]);
const documentKinds = ref(new Map<string, string>([[storyDocumentPath(props.initialStory.entry), "story"]]));
const documentDirty = ref(new Set<string>());

/** 重绑到某文档的会话：订阅状态回投到视图面（`attachSession` 的同款投影） */
function bindActive(doc: EditorDocument | undefined): void {
  if (doc === undefined) return;
  unsubscribeSession?.();
  unsubscribeSession = doc.session.subscribe((next: Story) => {
    story.value = next;
    undoDepth.value = doc.session.undoDepth;
    redoDepth.value = doc.session.redoDepth;
    dirty.value = doc.session.dirty;
    // ⚠️ 标签上的脏点也必须在这里刷新——编辑动作**只**触发会话订阅，
    //   不触发 workspace 结构变更（结构没变）⇒ 靠结构订阅刷新会让标签点**永不亮**
    //   （实测：编辑后顶栏「●」亮了但标签点没亮）。工具栏与标签栏是同一事实的两处投影。
    documentDirty.value = new Set(workspace.dirtyPaths);
  });
  session = doc.session;
  story.value = session.story;
  undoDepth.value = session.undoDepth;
  redoDepth.value = session.redoDepth;
  dirty.value = session.dirty;
  documentDirty.value = new Set(workspace.dirtyPaths);
}
let unsubscribeSession: (() => void) | undefined;
/**
 * **shallowRef**：会话树靠「commit 恒换引用」运作，从不原地深改——
 * 深代理（`ref`）会让 `story.value` 变成 proxy ≠ `session.current` 原始引用，
 * `markSaved(story.value)` 后 `dirty = current !== saved` **恒真**（保存后「● 未保存」
 * 永不消失，真机旅程实测）。浅引用直存直取，与乐观并发语义精确对齐。
 */
const story = shallowRef<Story>(session.story);
const undoDepth = ref(0);
const redoDepth = ref(0);
const selectedColumnId = ref<string>(session.story.entry);
const selectedPointer = ref<string | null>(null);
/** 右栏 tab（#8：属性面板从中央移入右栏作首 tab —— 跟随选中项的主编辑面；
 *  出餐页无 tab 位，由状态栏「出餐」按钮 toggle，见 #10） */
const rightTab = ref<"property" | "diagnostics" | "json" | "text" | "i18n" | "pack">("property");
const centerView = ref<"timeline" | "stage" | "graph" | "step">("timeline");
/**
 * 侧栏内页（活动栏的三个投影 + 故事编辑器专属的内页，同一面板内切）。
 *
 * 🔴 **`chapters` 与 `columns` 并存**（2026-10-05 接线，**不互相取代**）：
 * - `chapters` 章节树 = **路径推导的客观结构**（`Stories/chapter1/…` ⇒ 章节）
 * - `columns` 列列表 = **作者显式的手动分组**（编排视图）
 * 两者语义不同（见 `ChapterTree.vue` 头部说明），故为两个内页。
 */
type LeftTab = "resources" | "search" | "recent" | "chapters" | "columns" | "palette";
/**
 * 侧栏内页。
 *
 * 🔴 `chapters` 与 `columns` **必须带 `hint`**（2026-10-05）：两者都是"工程里的列"，
 * 光看名字分不出区别（真机实测用户会问"这两个 tab 有什么不同"）。
 * `hint` 作为 tab 的 `title` 悬停可读，**一句话说清口径差异**。
 */
const LEFT_TABS: readonly { id: LeftTab; label: string; hint?: string }[] = [
  { id: "resources", label: "资源", hint: "按文件种类浏览资源根（Resources/）" },
  { id: "search", label: "搜索", hint: "按**内容**搜索全部资源（先于名称匹配，它更精确）" },
  { id: "recent", label: "最近", hint: "最近改动过的资源" },
  {
    id: "chapters",
    label: "章节",
    hint: "章节树：按文件路径分章（Stories/chapter1/… ⇒ 章节 chapter1），结构由工程编排决定",
  },
  {
    id: "columns",
    label: "列",
    hint: "列列表：按作者手动分组排列（可自定义分组名与成员），与目录结构无关",
  },
  { id: "palette", label: "组件", hint: "插入元素：按类型挑模板（落到当前选中命令）" },
];
const leftTab = ref<LeftTab>("resources");

/* ——— 布局（可拖 + 可持久化，规划稿 §2.2①） ——— */
const layoutStore = createLayoutStore(readLocalStorage());
const layout = reactive<LayoutState>(layoutStore.load());
function persistLayout(): void {
  layoutStore.save(layout);
}
function setLeftWidth(width: number): void {
  layout.leftWidth = width;
  persistLayout();
}
function setRightWidth(width: number): void {
  layout.rightWidth = width;
  persistLayout();
}
/**
 * 诊断供给侧：打开工程才注入（`resourceFiles` / `overlayKeys`）。
 * 未打开 = `undefined` ⇒ `analyzeStory` 收到空 options，两个检查器族整体跳过（不误报）。
 */
const diagnosticSupply = ref<OpenedProject["diagnosticSupply"] | undefined>(undefined);

/* ——— 资源树（工程维度，资源管理器的主体面） ——— */
/** 工程资源集（逻辑路径）——由诊断供给侧顺带供给，零新增 IO */
const resourcePaths = computed<readonly string[]>(() =>
  [...(diagnosticSupply.value?.resourceFiles ?? [])].sort(),
);
const resourceNodes = computed<readonly ResourceNode[]>(() =>
  buildResourceTree(resourcePaths.value),
);
/* ——— 本地化工作台（聚合面；数据全部来自既有诊断供给，**零新增 IO**） ——— */
/**
 * 原文键全集（`extractStoryKeys` 消费整工程树 ⇒ 与诊断原文同口径）。
 * 未打开工程 = 空数组 ⇒ 工作台显示「无可译内容」而不是报错。
 */
const i18nSources = computed<readonly string[]>(() =>
  extractStoryKeys(projectTree.value ?? story.value),
);
/** 各语言键集合（由供给侧的分语言视图投影；`Lang/` 不存在 = 空） */
const i18nLangs = computed<readonly LangSummary[]>(() => {
  const byLang = diagnosticSupply.value?.overlayKeysByLang;
  if (byLang === undefined) return [];
  return [...byLang.entries()]
    .map(([lang, keys]) => ({
      lang,
      // 单文件形态用语言码本身作路径键（`Lang/{lang}.json`）；目录形态用 `main.json`
      files: new Map<string, readonly string[]>([[`Lang/${lang}/main.json`, [...keys].sort()]]),
    }))
    .sort((a, b) => (a.lang < b.lang ? -1 : 1));
});

const searchKeyword = ref("");
/** 内容搜索语料（逻辑路径 → 原始文本）：**按需加载并缓存**，不预读全部资源 */
const searchCorpus = ref<SearchCorpus>(new Map());
const corpusLoaded = ref(false);
const corpusLoading = ref(false);
/** 语料可含哪些文件：跳过媒体（巨大且文本检索无意义）与 `.enc`（密文） */
function isSearchable(path: string): boolean {
  if (path.endsWith(".enc")) return false;
  const kind = kindOfPath(path);
  return kind !== "image" && kind !== "audio" && kind !== "video" && kind !== "saves";
}
/** 加载语料：逐个读，**单个失败不阻断**（跳过即可，如实计入失败数） */
async function ensureCorpus(): Promise<void> {
  if (corpusLoaded.value || corpusLoading.value) return;
  const read = readTextFn.value;
  if (read === undefined) {
    corpusLoaded.value = true;
    return;
  }
  corpusLoading.value = true;
  const next: Record<string, string> = {};
  for (const path of resourcePaths.value) {
    if (!isSearchable(path)) continue;
    try {
      next[path] = await read(path);
    } catch {
      // 读不到就跳过（不在结果里假装它没有内容）
    }
  }
  searchCorpus.value = new Map(Object.entries(next));
  corpusLoaded.value = true;
  corpusLoading.value = false;
}
/** 切到搜索面板 ⇒ 按需拉语料 */
watch(
  () => leftTab.value,
  (tab) => {
    if (tab === "search" || tab === "recent") void ensureCorpus();
  },
);
/** 语料作废（换工程时调用：旧语料是另一个工程的内容）。
 *  ⚠️ **不用 `watch(resourcePaths)`**：`watch` 会**立即求值**源以建立依赖，
 *  而 `resourcePaths` 依赖的 `diagnosticSupply` 在 setup 靠后处才声明 ⇒ TDZ 崩
 *  （实测「Cannot access 'diagnosticSupply' before initialization」）。
 *  改在**工程真正变化的地方**（`applyOpened` / `unbindProject`）显式调用。 */
function invalidateCorpus(): void {
  searchCorpus.value = new Map();
  corpusLoaded.value = false;
}
const searchReport = computed(() =>
  searchResources(searchCorpus.value, searchKeyword.value),
);
/** 只读资源的如实提示（不假装能编辑；空串 = 无提示） */
/** 搜索过滤：匹配**文件名或完整路径**（大小写不敏感）；空关键词 = 不过滤 */
const searchFilter = (node: ResourceNode): boolean => {
  const q = searchKeyword.value.trim().toLowerCase();
  if (q === "") return false;
  return (
    node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)
  );
};
/** 最近打开：只出**已打开过的文档**（= 当前标签集合；本批标签即已打开资源） */
const recentFilter = (node: ResourceNode): boolean =>
  workspace.get(node.path) !== undefined;
/** 「宿主未启动」提示：非阻塞横幅（可关闭），**不用模态**——见探测处注 */
const hostHint = ref(false);

/* ——— 顶栏（步1 瘦身）—— */
/** 「⋯」溢出菜单开合（点击外部/Esc 关闭由 `closeToolMenuOnOutside` 兜） */
const toolMenuOpen = ref(false);
/** 工程名（chip 主文本）：优先取资源根目录名，其次 story.id */
const projectName = computed(() => {
  const root = projectRoot.value;
  if (root === "") return story.value.id;
  const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || root;
});
/**
 * chip tooltip（**两行各标身份，不混同**）：
 * ① 工程资源根 = FSA 打开的目录名（浏览器拿不到绝对路径——这是平台事实，不编造）；
 * ② 宿主工作区根 = watch 端点回传的完整磁盘路径（**宿主监视根**，可能与所开工程不同）。
 */
const projectChipTitle = computed(() => {
  if (projectRoot.value === "") return "尚未打开工程";
  const lines = [`工程资源根：${projectRoot.value}`];
  if (hostRoot.value !== "") lines.push(`宿主工作区根：${hostRoot.value}`);
  return lines.join("\n");
});
/** 导入按钮的取径：走隐藏 input（自动化可触发） */
function pickImport(): void {
  importInput.value?.click();
}

/**
 * 「⋯」菜单的关闭时机（**可访问性底线**：键盘用户必须能退出）。
 * - `Esc` 关闭；
 * - 点击菜单**外部**关闭；
 * - ⚠️ 少了这两条，菜单就只能靠再点同一个按钮收起 ⇒ 键盘用户被卡住。
 */
function onToolMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    toolMenuOpen.value = false;
    event.stopPropagation();
  }
}
function onDocumentPointerDown(event: PointerEvent): void {
  if (!toolMenuOpen.value) return;
  const target = event.target as Node | null;
  if (target !== null && toolMenuAnchor.value?.contains(target)) return;
  toolMenuOpen.value = false;
}


/**
 * 热重载开关（作者可关）。默认**开**——它是「代码归外部编辑器」这个定位能成立的
 * **前提能力**：外部改完看不到，定位就只是半截。
 */
const hotReloadEnabled = ref(true);
/** 热重载是否真的在跑（宿主监视失败 ⇒ false，状态栏如实显示「不可用」） */
const hotReloadActive = ref(false);
/** 停轮询（页面卸载 / 开关关闭时用） */
let stopHotReload: (() => void) | undefined;

/** 宿主能力探测：本地服务在不在（决定「外部编辑器打开」等动作是否可做） */
const localHost = ref<LocalHostEndpoint | undefined>(undefined);
const localHostAvailable = computed(() => localHost.value !== undefined);
/**
 * 能力探测：命中 ⇒ 完整体验；未命中 ⇒ 浏览器形态（**正常**路径，但**要说清怎么变完整**）。
 *
 * ⚠️ **为什么放在 `onMounted` 而不是 setup 顶层的裸 IIFE**（CDP 实测踩出来的）：
 *   裸 IIFE 在 setup 里**一次都没执行**（`Network` 域抓到启动期零请求，
 *   而同一份代码手动调用完全正常 ⇒ 模块求值时机不可靠）。
 *   `onMounted` 是"组件已挂载、DOM 与子组件就绪"的**契约时刻**，探测放这里既可靠又不浪费。
 */
onMounted(() => {
  void (async () => {
    const host = await detectLocalHost();
    localHost.value = host;
    // ⚠️ 提示**绝不模态**（我先犯过一次：用 `dialog.notify` ⇒ `DialogHost` 遮罩是
    //   `inset:0` 全屏 ⇒ 不关掉就**挡住全部点击**，表现为"点故事没反应"）。
    //   降级是"可用但能力受限"，用 `pointer-events:none` 的横幅说清，不拦操作。
    if (host === undefined) hostHint.value = true;
    else {
      // 宿主工作区根（完整磁盘路径，watch 端点回传）——chip tooltip 的「全路径」来源。
      // ⚠️ 它是**宿主监视根**，不必然等于用户 FSA 打开的工程目录（两者各自陈述，不混同）。
      void fetchWatchStatus(host).then((status) => {
        if (status?.root !== undefined) hostRoot.value = status.root;
      });
      if (hotReloadEnabled.value) startHotReload(host);
    }
  })();
});

/* ——— 热重载（规划稿 04 册 §5「本地形态收益」之一） ——— */

/**
 * 起热重载轮询。
 *
 * ⚠️ **脏文档保护**：有未保存改动时**不自动重载**，只提示 ——
 * 静默重载会丢掉作者的改动（与 `Workspace.replaceClean` 拒绝脏文档同款纪律）。
 */
function startHotReload(host: LocalHostEndpoint): void {
  stopHotReload?.();
  hotReloadActive.value = true;
  stopHotReload = pollWatch(host, () => {
    if (workspace.dirtyCount > 0) {
      void dialog.notify({
        title: "检测到磁盘变更，但当前有未保存改动",
        message: "为避免丢失你的改动，未自动重载。请先保存，或撤销改动后等待自动重载。",
        tone: "warning",
      });
      return;
    }
    void reloadFromDisk();
  });
}

/** 从磁盘重新供给（重开工程通道 —— 唯一已验证的重新枚举路径） */
async function reloadFromDisk(): Promise<void> {
  const entry = props.lastProject?.value;
  if (entry === undefined) return;
  openError.value = "";
  try {
    await applyOpened(await entry.reopen());
  } catch (error: unknown) {
    openError.value = `热重载失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

onBeforeUnmount(() => {
  stopHotReload?.();
  stopHotReload = undefined;
});
onMounted(() => document.addEventListener("pointerdown", onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointerDown));

/**
 * 空态主动作（E5：空态必须给出可点的下一步）。
 * 「打开工程」走真实取径；「用外部编辑器打开」本批**如实不可用**（B4 才落地）⇒ 不假装。
 */
function onEmptyAction(action: EmptyAction): void {
  if (action.id === "open-project") {
    void openProject();
    return;
  }
  // 无宿主 ⇒ 如实说"不可用"，**不假装**（浏览器形态物理上无法启动进程）
  void dialog.notify({
    title: "当前形态无法用外部编辑器打开",
    message: "需要本地应用宿主（pnpm --filter @lingfan/editor-app host）。请先用「打开工程」。",
    tone: "info",
  });
}

/**
 * 打包请求转发（快速出餐）：**前端不 spawn 进程**，只发请求给本地宿主。
 *
 * ⚠️ token 从哪来：宿主把 `capabilities` 打进 `/__editor_host__/ping` 的响应里
 * 才是正解，但当前 ping 只回 `{ok:true}`（不泄露任何路径/token）。
 * ⇒ 这里改为**从探测时的基址直接请求 `/{token}/pack`** 需要 token ⇒
 *   走既有 `localHost` 端点对象里的 token（探测时由宿主一并给出）。
 *
 * `packing` 记账（#10）：打包以分钟计，面板切走后**状态栏仍显示「打包中…」**
 * ——长任务的存在感不随面板显隐丢失。
 */
const packing = ref(false);
async function sendPackRequest(request: PackRequest): Promise<PackResult> {
  const host = localHost.value;
  if (host === undefined || host.token === "") {
    return { ok: false, reason: "本地宿主未就绪（缺少访问令牌）" };
  }
  packing.value = true;
  try {
    const res = await fetch(`${host.baseUrl}/__editor_host__/${host.token}/pack`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) return { ok: false, reason: `宿主返回 ${String(res.status)}` };
    return (await res.json()) as PackResult;
  } catch (error: unknown) {
    return { ok: false, reason: `无法联系本地宿主：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    packing.value = false;
  }
}

/** 状态栏「出餐」入口（#10 下沉）：toggle 右栏出餐页——已在 ⇒ 回诊断 */
function togglePackPane(): void {
  rightTab.value = rightTab.value === "pack" ? "diagnostics" : "pack";
}

/** 打开资源：按分派表路由到对应视图（未命中 ⇒ 只读，不报错） */
function openResource(path: string): void {
  const kind = kindOfPath(path);
  const spec = viewOfKind(kind);
  if (spec.view === "story") {
    // 故事文档身份 = 合成路径 `Stories/<列id>.json`；但磁盘上的故事文件可能是
    // **多列 `.story`**（真实工程形态，路径与列 id 天然不同族）——
    // 反查口径：**sourcePath === 该文件的第一个列**（列序，工程级事实）。
    const columnId =
      columnIdOfDocument(path) ??
      firstColumnIdOfSourcePath(projectTree.value ?? story.value, path);
    if (columnId === undefined) {
      // .story 文件里没有任何可解析列（坏档 / 全是注释）——如实告知，不静默无反应
      void dialog.notify({
        title: "该故事文件没有可打开的场景",
        message: `「${path}」里没有解析出任何列（可能是空文件或结构损坏）。`,
        tone: "warning",
      });
      return;
    }
    // 🔴 文档身份恒 = `storyDocumentPath(columnId)`（**不是**磁盘文件路径——
    //   .story 文件路径只是反查键；用它开档会破坏「一文档 = 一列」的身份不变量，
    //   redistribute / selectedColumnId 同步全部失配）。默认路径工程两者同形，行为不变。
    const docPath = storyDocumentPath(columnId);
    if (workspace.get(docPath) !== undefined) {
      selectDocument(docPath);
    } else {
      // 工程里已存在的列但未打开 ⇒ 打开它（真实单列文档，从整工程树切出）
      const column = (projectTree.value ?? story.value).columns.find((c) => c.id === columnId);
      if (column === undefined) return;
      workspace.open(docPath, "story", {
        ...(projectTree.value ?? story.value),
        entry: columnId,
        columns: [column],
      });
      selectDocument(docPath);
    }
    selectedColumnId.value = columnId;
    return;
  }
  if (spec.editable || spec.view === "media" || spec.view === "readonly") {
    // 非故事资源：**不进 workspace 标签**（本批无独立会话/写回路径），
    // 而是以「资源预览」形态在中心区显示（状态在 activeResource 上）。
    activeResource.value = path;
    void loadResourceText(path);
  }
}

/* ——— 非故事资源（中心区） ——— */
const activeResource = ref<string | undefined>(undefined);
/** 资源原始文本（读取中 = `undefined`；失败 = `readError` 有值） */
const activeSource = ref<string | undefined>(undefined);
const readError = ref("");
/** 读资源文本：失败**如实报错**（不静默显示空内容——那会被误读成"文件是空的"） */
async function loadResourceText(path: string): Promise<void> {
  activeSource.value = undefined;
  readError.value = "";
  const read = readTextFn.value;
  if (read === undefined) {
    readError.value = "未打开工程（无资源读取能力）";
    return;
  }
  try {
    activeSource.value = await read(path);
  } catch (error: unknown) {
    readError.value = `读取失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** 活动资源的种类与视图分派（分派表是路由唯一事实源） */
const activePath = computed<string>(() => activeResource.value ?? workspace.activePath ?? "");
const activeKind = computed<ResourceKind>(() =>
  activeResource.value !== undefined ? kindOfPath(activeResource.value) : "story",
);
const activeSpec = computed(() => viewOfKind(activeKind.value));
/**
 * 媒体种类（收窄）：分派表只在 `image`/`audio`/`video` 时路由到 `MediaView`，
 * 但类型系统不知道那张表的内容 ⇒ 显式收窄而非在组件里 cast。
 */
const activeMediaKind = computed<"image" | "audio" | "video" | "other">(() => {
  const kind = activeKind.value;
  return kind === "image" || kind === "audio" || kind === "video" ? kind : "other";
});
const activeReadOnlyReason = computed(() => {
  if (activeKind.value === "saves") return "运行时产物：Saves 归工程运行时，编辑器不提供编辑面";
  return "未识别的资源类型：编辑器不提供编辑面（可用外部工具查看）";
});

/** 保存非故事文本资源（译文表 / 清单） */
async function saveTextResource(path: string, text: string): Promise<void> {
  const run = saveTextFn.value;
  if (run === undefined) {
    readError.value = "该资源类型尚不支持保存（无写回能力）";
    return;
  }
  saving.value = true;
  saveError.value = "";
  saveNotice.value = "";
  try {
    const report = await run(path, text);
    saveNotice.value = `已保存：写入 ${report.written.length} 个文件`;
  } catch (error: unknown) {
    saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
}
/**
 * 骨架生成（本地化工作台「新建语言」）：委托纯函数产出文件内容，落盘走**既有**写回端口。
 *
 * ⚠️ 增量语义：已存在的语言传 `existing` ⇒ `planOverlaySkeleton` 保留既有译文
 * （只补新键），不会把译者的工作抹掉。
 */
async function generateLangSkeleton(request: {
  lang: string;
  layout: SkeletonLayoutChoice;
}): Promise<void> {
  const run = saveTextFn.value;
  if (run === undefined) {
    await dialog.notify({
      title: "未绑定磁盘工程",
      message: "生成骨架需要写回能力。请先「打开工程」并授予编辑权限。",
      tone: "warning",
    });
    return;
  }
  // 每个故事 → 该故事的原文键（键 = 故事文件相对 Stories/ 的路径，不含扩展名）
  const tree = projectTree.value ?? story.value;
  const storyKeys = groupKeysByStory(
    new Map(tree.columns.map((c) => [c.id, extractStoryKeys({ ...tree, entry: c.id, columns: [c] })])),
  );
  // 增量：该语言已存在的译文（键 = 逻辑路径）
  const read = readTextFn.value;
  const existing = new Map<string, Record<string, string>>();
  for (const summary of i18nLangs.value) {
    if (summary.lang !== request.lang) continue;
    for (const path of summary.files.keys()) {
      if (read === undefined) break;
      const text = await read(path).catch(() => undefined);
      if (text === undefined) continue;
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          existing.set(path, parsed as Record<string, string>);
        }
      } catch {
        // 坏 JSON 不当既有译文（骨架会重生成该文件；原坏文件由 diff 覆盖）
      }
    }
  }
  let files: ReturnType<typeof planOverlaySkeleton>;
  try {
    files = planOverlaySkeleton({
      lang: request.lang,
      layout: request.layout,
      storyKeys,
      existing,
    });
  } catch (error: unknown) {
    // 非法语言码等 ⇒ fail-closed，如实报错（不静默生成一半）
    await dialog.notify({
      title: "无法生成骨架",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
    return;
  }
  saving.value = true;
  try {
    for (const file of files) await run(file.path, file.content);
    saveNotice.value = `已生成 ${request.lang} 骨架：${files.length} 个文件`;
    // 骨架已落盘 ⇒ 重新枚举资源与译文键（`Lang/**` 结构变了，诊断与工作台都要跟上）。
    // ⚠️ 走既有「重开上次工程」通道（`entry.reopen()`）—— 它是**唯一**已验证的重新供给路径
    //   （重新枚举 + 重建 supply + 重投影），不另造第二条。
    const entry = props.lastProject?.value;
    if (entry !== undefined) applyOpened(await entry.reopen());
  } catch (error: unknown) {
    saveError.value = `生成失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
}

const previewing = ref(false);
/** 已打开工程：资源供给端口（未打开 = undefined → 预览不解析资源，维持示例语义） */
const resourcePort = ref<ResourcePort | undefined>(undefined);
/** 已打开工程的资源根名（界面显示；空 = 示例故事） */
const projectRoot = ref("");
/** 宿主工作区根的完整磁盘路径（watch 端点回传；空 = 浏览器形态或宿主未回传）。
 *  ⚠️ 与 `projectRoot` 是**两个事实**：前者是宿主监视根，后者是 FSA 打开的目录名
 *  （浏览器拿不到绝对路径）——tooltip 各自标注身份，不猜两者同一。 */
const hostRoot = ref("");
/** #11 降级打开回执（缺 project.json ⇒ 合成清单打开）；undefined = 正常打开 */
const degradedOpen = ref<DegradedOpen | undefined>(undefined);
/** 层级表：打开工程 = 清单 `shell.layers` 覆盖；未打开 = 内建默认（预览解析实例级 z 用） */
const layerZ = ref<LayerZTable>(DEFAULT_LAYER_Z);
const openError = ref("");
/** 保存回磁盘：`undefined` = 未打开工程或只读取径 → 保存禁用 */
const saveFn = ref<((s: Story) => Promise<ProjectWriteReport>) | undefined>(
  undefined,
);
/** 单文档写回（多文档面的实际保存路径；存在即优先于整工程 `saveFn`） */
const saveColumnFn = ref<
  ((columnId: string, columnStory: Story) => Promise<ProjectWriteReport>) | undefined
>(undefined);
/** 按逻辑路径读资源文本（非故事视图的数据源；缺省 = 未打开工程） */
const readTextFn = ref<((path: string) => Promise<string>) | undefined>(undefined);
/** 保存单个文本资源（译文表 / 清单）；缺省 = 无写回能力 */
const saveTextFn = ref<
  ((path: string, text: string) => Promise<ProjectWriteReport>) | undefined
>(undefined);
/** 保存前规范化检测（与 save 同源装配；缺省 = 只读取径或无检测） */
const inspectSaveFn = ref<
  ((s: Story) => WriteNormalizationFinding | undefined) | undefined
>(undefined);
/** 不可保存时的可操作提示（按钮 title） */
const saveHint = ref("");
const saving = ref(false);
const dirty = ref(false);
const saveError = ref("");
const saveNotice = ref("");
const fallbackInput = useTemplateRef<HTMLInputElement>("fallbackInput");
const importInput = useTemplateRef<HTMLInputElement>("importInput");
const toolMenuAnchor = useTemplateRef<HTMLElement>("toolMenuAnchor");

/**
 * 保存前规范化确认：检测有发现时暂存保存动作（确认后执行），界面展示
 * 「将被转换/移除的文件」清单。「不再提示」为本机视图偏好（不入故事 JSON，
 * 存储失败静默降级 = 仅本次会话有效）。
 */
const normalizationNotice = ref<string[]>([]);
const pendingSave = ref<((s: Story) => Promise<ProjectWriteReport>) | undefined>(
  undefined,
);
const skipNormalizationNotice = ref(
  readSkipNormalizationNotice(readLocalStorage()),
);

/** 浏览器可能禁站点数据（取 `localStorage` 本身即抛）——失败即无持久化，不影响可用性 */
function readLocalStorage(): KeyValueStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * 列分组归类：**UI 侧元数据**——按 `story.id` 存本机、不入故事 JSON。
 * 列序 = 文件路径码元序属**叙事语义**，用存储层目录分组会隐式改写它；归类只是作者视图偏好。
 * 降级与节点图布局同款：读失败 → 平铺；写失败 → 仅本次会话有效。
 */
const groupingStore = createColumnGroupingStore(readLocalStorage());
const grouping = ref<ColumnGroupingView>(emptyGroupingView());

/** 换工程 / 新建 / 导入都随 `story.id` 归位（不照抄节点图的「onMounted 只读一次」） */
watch(
  () => story.value.id,
  (id) => {
    grouping.value = groupingStore.load(id);
  },
  { immediate: true },
);

/** 分组视图变更：原引用（无变化）跳过落盘——视图偏好不产生 undo、不动 dirty */
function commitGrouping(next: ColumnGroupingView): void {
  if (next === grouping.value) return;
  grouping.value = next;
  groupingStore.save(story.value.id, next);
}

/** 列集合变化后裁剪悬空成员（删列 / 改名）；渲染侧另有惰性裁剪兜底 */
function syncGroupingColumns(): void {
  commitGrouping(
    pruneGroupingView(
      grouping.value,
      story.value.columns.map((column) => column.id),
    ),
  );
}

/** 未绑定磁盘工程时的提示（状态口径：不携带「刚点了新建/导入」这类历史） */
const UNBOUND_HINT =
  "未绑定磁盘工程：请用「打开工程」选择目录以启用保存";

/**
 * 换会话基线与绑定订阅：打开工程 = **新基线**（不是一次 undo——
 * 否则撤销会退回上一个工程的树）。
 *
 * 多文档面：先落进 `workspace`（成为活动文档），再由 `bindActive` 统一重绑——
 * 这样「打开工程」与「切标签」走**同一条**绑定路径（不新增第二处投影逻辑）。
 */
function attachSession(next: EditorSession): void {
  workspace.open(
    storyDocumentPath(next.story.entry),
    "story",
    next.story,
  );
  bindActive(workspace.activeDocument);
}
attachSession(session);

/**
 * 活动文档路径的**响应式投影**。
 *
 * 🔴 `workspace` 是普通类实例（非 reactive）——模板里读 `workspace.activePath`
 * 靠「其他 ref 变更带动重渲染」碰巧刷新，而 **computed 读它则永不重算**
 * （真机实测：资源树高亮卡在挂载初值，切列不跟）。订阅回调里显式投影成 ref，
 * 一切「随活动文档走」的派生（resourceFocusPath 等）只吃这个 ref。
 */
const activeDocumentPath = ref<string | undefined>(workspace.activePath);

/** 标签页（文档集合）变更 → 活动文档可能已变 ⇒ 重绑 + 刷新文档态派生 */
workspace.subscribe(() => {
  activeDocumentPath.value = workspace.activePath;
  bindActive(workspace.activeDocument);
  documentPaths.value = workspace.documents.map((d) => d.path);
  documentKinds.value = new Map(workspace.documents.map((d) => [d.path, d.kind]));
  documentDirty.value = new Set(workspace.dirtyPaths);
});

/**
 * 切换标签：重绑到该文档（内容未加载时先落活动位，视图面走加载态）。
 *
 * ⚠️ 同时**同步 `selectedColumnId` 到该文档的 entry 列**：时间线/节点图/步骤图都按
 * `selectedColumnId` 在**当前 `story`** 里找列（`StoryTimeline:34`
 * `props.story.columns.find(c => c.id === props.columnId)`）。
 * 切标签只换了 `story`（单列文档）却让 `selectedColumnId` 停在**上一个文档的列** ⇒
 * 在新 `story` 里找不到该列 ⇒ **时间线空白**（实测：首次点 tab 空白，再点一次就好——
 * 因为上一次的 `selectedColumnId` 恰好已等于目标列）。
 * 故事文档的 entry 就是它的列 id ⇒ 这里按不变量同步，而非记一份映射表。
 */
function selectDocument(path: string): void {
  workspace.activate(path);
  const columnId = columnIdOfDocument(path);
  if (columnId !== undefined) {
    selectedColumnId.value = columnId;
    // 命令选中态同属"这份文档"——跨文档保留上一份文档的指针只会指向不存在的行
    selectedPointer.value = null;
  }
}

/**
 * 关闭文档标签（✕ / 中键，2026-10-05 真机缺口：此前标签**没有任何关闭途径**）。
 *
 * 脏文档**先确认**（`workspace` 不猜用户意图——canClose 是既有判据）；
 * 关闭后的重绑 / 文档派生刷新由 `workspace.subscribe` 统一处理；
 * 关活动标签 ⇒ 顺延位成为新活动 ⇒ `selectDocument` 同口径同步 `selectedColumnId`
 * （否则它停在**被关列**上，时间线在新活动文档里找不到列 ⇒ 空白——
 * 与 `selectDocument` 注释里记录的是同一类缺陷，别再犯）。
 */
async function closeDocument(path: string): Promise<void> {
  if (!workspace.canClose(path)) {
    const ok = await dialog.askConfirm({
      title: `关闭「${columnIdOfDocument(path) ?? path}」？`,
      message: "该标签有未保存的改动，关闭将丢弃（磁盘仍是上次保存的内容）。",
      danger: true,
    });
    if (!ok) return;
  }
  workspace.close(path);
  if (workspace.activePath !== undefined && workspace.activePath !== path) {
    selectDocument(workspace.activePath);
  }
}

/**
 * **按需打开某列的文档**（**单列切片**）。
 *
 * 🔴 为什么按需（2026-10-05）：打开工程时**预开所有列**会让 62 列的工程在顶部铺
 * 50 个标签（`Workspace` 容量 50 还会静默截断 12 列 —— 见 `columnPaths` 的注释）。
 * 而「列 = 文档」的语义（每个标签持**独立单列会话**，防跨标签覆盖 = B0 的数据丢失防线）
 * **不需要预开**：用户点到哪一列，就为哪一列建会话。
 *
 * ⚠️ 切片必须与 `applyOpened` 原口径完全一致（`{...tree, entry: id, columns: [列]}`）：
 * 整棵树塞进每个标签会让两标签各持**旧副本**，后保存的覆盖先保存的。
 */
function openColumnDocument(id: string): void {
  const path = storyDocumentPath(id);
  if (workspace.get(path) !== undefined) return; // 已开：复用（不丢未保存改动）
  const tree = projectTree.value ?? story.value;
  const column = tree.columns.find((c) => c.id === id);
  if (column === undefined) return; // fail-closed：列不存在，不造半个文档
  workspace.open(path, "story", { ...tree, entry: id, columns: [column] });
}

/**
 * 工程级操作（新增/删除列）改的是**文件集** ⇒ 各单列文档必须按新树重新切分。
 *
 * ⚠️ 纪律：**只重切受影响的文档**，未编辑过的文档保留原会话引用
 * （重建它们会连带丢掉各自的 undo 栈与脏标记 —— 实测会表现为「改了一列，
 * 另一列的未保存改动消失」）。判定用「脏或内容有别于新树」，不靠猜。
 */
function redistributeDocuments(tree: Story): void {
  const byId = new Map(tree.columns.map((column) => [column.id, column]));
  // 删掉的列 ⇒ 关掉对应文档（脏文档不静默丢：留在标签栏等用户处理）
  for (const path of [...documentPaths.value]) {
    const columnId = columnIdOfDocument(path);
    if (columnId === undefined || !byId.has(columnId)) {
      if (workspace.canClose(path)) workspace.close(path);
    }
  }
  // ⚠️ 用 `markSaved` 换引用而非 `commit`：`commit` 会压一个 undo 单元，
  // 那样"新增列"会给**每个**未编辑文档各记一条假历史（撤销键会出现一堆噪声）。
  // 该文档本就干净 ⇒ 换基线等价于「无变更」，不产生历史是正确语义。
  for (const column of tree.columns) {
    const path = storyDocumentPath(column.id);
    const doc = workspace.get(path);
    // 🔴 **未打开的列不主动开**（2026-10-05 按需打开）：工程级操作（增删列）只负责让
    // **已打开**的文档反映新树。用户从章节树点到新列时 `selectColumn` 会为它建会话。
    // 否则一次「新增一列」会把**所有没开过的列**铺成标签（真机 62 列 ⇒ 50 个标签）。
    if (doc === undefined) continue;
    if (doc.session.dirty) continue; // 保住未保存改动与历史
    workspace.replaceClean(path, {
      ...tree,
      entry: column.id,
      columns: [column],
    });
  }
  documentPaths.value = tree.columns.map((column) => storyDocumentPath(column.id));
  documentDirty.value = new Set(workspace.dirtyPaths);
}

/** 打开工程（两种取径都经组合根注入的 opener；失败只提示，不动当前工程） */
async function openProject(): Promise<void> {
  openError.value = "";
  if (!props.opener.supportsPicker) {
    fallbackInput.value?.click(); // 无 FSA（Firefox/Safari）→ 目录 input 兜底
    return;
  }
  try {
    await applyOpened(await props.opener.pick());
  } catch (error: unknown) {
    openError.value = `打开工程失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

/** 「记住上次工程」：一键重开（点击即手势，读权限按需申请） */
async function reopenLastProject(): Promise<void> {
  const entry = props.lastProject?.value;
  if (entry === undefined) return;
  openError.value = "";
  try {
    await applyOpened(await entry.reopen());
  } catch (error: unknown) {
    openError.value = `重新打开失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function onFallbackFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ""; // 允许重复选同一目录
  if (files.length === 0) return;
  openError.value = "";
  try {
    await applyOpened(await props.opener.fromFiles(files));
  } catch (error: unknown) {
    openError.value = `打开工程失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function applyOpened(opened: OpenedProject | undefined): void {
  if (opened === undefined) return; // 用户取消
  // 按列装载**真实单列文档**（标签页的语义 = 一个资源 = 一个会话）：
  // 每列从工程树里抽出自己那一份，各持独立 `EditorSession` ⇒ 标签间改写互不覆盖。
  // ⚠️ 不用「整棵树塞进每个标签」的写法——那会让两个标签各持一份**旧副本**，
  // 后保存的覆盖先保存的（这正是 B0 要防的数据丢失）。
  const tree = opened.story;
  projectTree.value = tree; // 诊断基准 = 整工程树（跨列引用需全局视角）
  // 🔴 **只开入口列**（2026-10-05）：预开所有列会让 62 列的工程铺 50 个标签
  //    （`Workspace` 容量 50 还会静默截断 12 列），而「列 = 文档」的语义**不需要预开**——
  //    用户点到哪一列，`selectColumn` 就为哪一列建会话（见 `openColumnDocument`）。
  openColumnDocument(tree.entry);
  // 标签顺序 = 列序（= 文件路径码元序，叙事语义）。
  // ⚠️ 只对**已打开的**文档排序：未开的列没有文档，硬塞进 `documentPaths` 会铺出
  //    点不开的假标签（切换时 `activate` 找不到文档）。
  const ordered = tree.columns
    .map((column) => storyDocumentPath(column.id))
    .filter((path) => workspace.get(path) !== undefined);
  for (const path of [...documentPaths.value]) {
    if (!ordered.includes(path)) workspace.close(path);
  }
  documentPaths.value = ordered;
  workspace.activate(storyDocumentPath(tree.entry));
  bindActive(workspace.activeDocument);
  selectedPointer.value = null;
  selectedColumnId.value = tree.entry;
  resourcePort.value = opened.resourcePort;
  layerZ.value = opened.layerZ; // 预览用工程层级表解析实例级 z
  diagnosticSupply.value = opened.diagnosticSupply; // 资源/译文检查器生效
  projectRoot.value = opened.root;
  degradedOpen.value = opened.degraded; // #11：缺清单降级的事实显式上状态栏
  saveFn.value = opened.save;
  saveColumnFn.value = opened.saveColumn;
  readTextFn.value = opened.readText;
  saveTextFn.value = opened.saveText;
  invalidateCorpus(); // 换工程 ⇒ 旧语料作废（内容属于上一个工程）
  inspectSaveFn.value = opened.inspectSave;
  saveHint.value = opened.saveHint ?? "";
  saveError.value = "";
  saveNotice.value = "";
  cancelNormalization(); // 换工程：上一次暂存的确认已过期（基线随会话换新）
}

/**
 * 解绑磁盘工程：「新建 / 导入」是内存态故事，若保持绑定，
 * 一次误点保存会把示例/导入内容覆盖真实工程——故一律解绑。
 * 提示用**状态口径**（「未绑定」而非「你刚点了新建」）：绑定状态不随 undo 回滚，
 * 若文案携带历史，撤销「新建」后就会留下过期说明。
 */
function unbindProject(): void {
  saveFn.value = undefined;
  saveColumnFn.value = undefined;
  readTextFn.value = undefined;
  saveTextFn.value = undefined;
  invalidateCorpus();
  activeResource.value = undefined;
  activeSource.value = undefined;
  inspectSaveFn.value = undefined;
  saveHint.value = UNBOUND_HINT;
  projectRoot.value = "";
  degradedOpen.value = undefined; // 解绑 = 降级态一并作废（绑定状态不随 undo 回滚）
  resourcePort.value = undefined;
  layerZ.value = DEFAULT_LAYER_Z; // 解绑后回内建层级表
  diagnosticSupply.value = undefined; // 解绑后回「无供给侧」= 检查器族跳过
  projectTree.value = undefined; // 诊断基准随之归零（回落到当前活动树）
  saveError.value = "";
  saveNotice.value = "";
  cancelNormalization(); // 解绑 = 保存能力消失，暂存的确认一并作废
}

/**
 * 文档标签区的「+」：**新增一个流程（flow）列** = 新增一个文档。
 *
 * ⚠️ 与 `onNew` 的区别（别混）：`onNew` 是「**新建整个工程**」（重置为示例故事），
 *   那是工程级动作，放在「⋯」菜单里；这里是**文档级**动作，与 tab 同级。
 */
async function addFlowColumn(): Promise<void> {
  const result = await dialog.askText({
    title: "新增流程列",
    message: "列 id 建议用语义化短标识（如 tavern / morning）；留空则自动生成 column-N。",
    initial: "",
    allowEmpty: true,
  });
  if (result === null) return; // 取消 = 不新建（D-58 语义：取消 ≠ 留空）
  const intent = decideAddColumn(result);
  if (!intent.run) return;
  api.addColumn("flow", intent.hint);
}

function onNew(): void {
  api.replaceAll(sampleStory(), "新建");
  unbindProject();
}

/**
 * 诊断集：打开工程后注入供给侧数据（资源缺失 / 未使用译文键两个检查器才生效，
 * 见诊断供给侧）；未打开工程 = 空 options（跳过相关诊断族，不误报）。
 *
 * ⚠️ 诊断吃的是**整工程树**（`projectTree`），不是活动标签的单列切片：
 * 跨列引用（如 `jump`/`menu` 指向另一列的列 id）在切片视角下会被判成
 * 「missing-target 目标不存在」——而目标其实就在另一个标签里（真机实测误报 1 error + 34 warning）。
 * 诊断是**工程级**关注点，不随标签切片。
 */
const projectTree = ref<Story | undefined>(undefined);
/**
 * **列 id → 来源文件路径**（章节树的路径面；2026-10-05 接线）。
 *
 * 🔴 **为什么不能拿「已打开的文档」推导**（我第一版就是这么写的，真机实测翻车）：
 * `Workspace` 有**容量上限 `capacity = 50`**，打开 62 列的工程会挤掉 12 列；
 * 而 `workspace.documents` 只含**还开着的 50 个** ⇒ 被挤掉的列**在章节树里没有路径**
 * ⇒ label 为空（实测 `chapter1_start` —— 它是 entry 列，最早打开最先被挤掉）。
 *
 * **权威来源 = 组装器回填的 `sourcePath`**：`assembleProject` 解析每个文件时就知道
 * 每列来自哪个文件（一个文件可承载**多列** ⇒ 多对一），这是**工程级事实**，
 * 与「哪些文档还开着」无关。单文件工程无 `sourcePath` ⇒ 退化为平铺（不报错）。
 */
const columnPaths = computed(() => {
  const tree = projectTree.value ?? story.value;
  const map = new Map<string, string>();
  for (const column of tree.columns) {
    if (typeof column.sourcePath === "string" && column.sourcePath !== "") {
      map.set(column.id, column.sourcePath);
    }
  }
  return map;
});
/**
 * 工程级**第一个场景列**的 id（舞台空态动作的导航目标）。
 * 舞台组件吃的是单列切片（切片里找不到别的列）⇒ 工程级导航必须由宿主给。
 */
const firstSceneColumnId = computed<string | null>(() => {
  const tree = projectTree.value ?? story.value;
  return tree.columns.find((c) => c.kind === "scene")?.id ?? null;
});
/**
 * 资源树的**定位路径**（磁盘事实）：活动文档路径是合成的 `Stories/<列id>.json`，
 * 而树节点是**磁盘路径**（`.story` 多列文件）——两者不同族，直接拿 activePath
 * 高亮对 `.story` 工程**永不命中**（真机实测「不能定位当前打开的」第二根因）。
 * 映射：列的 `sourcePath`（组装器回填的工程级事实）优先；无 `sourcePath`
 * （单列 .json 默认路径）⇒ 合成路径与磁盘路径同形，原样用。
 */
const resourceFocusPath = computed<string | undefined>(() => {
  const active = activeDocumentPath.value;
  if (active === undefined) return undefined;
  const columnId = columnIdOfDocument(active);
  if (columnId === undefined) return active;
  const tree = projectTree.value ?? story.value;
  const column = tree.columns.find((c) => c.id === columnId);
  const source = column?.sourcePath;
  return typeof source === "string" && source !== "" ? source : active;
});
const diagnostics = computed(() => {
  const tree = projectTree.value ?? story.value;
  const supply = diagnosticSupply.value;
  return supply === undefined
    ? analyzeStory(tree)
    : analyzeStory(tree, {
        // ⚠️ 只喂 `analyzeStory` 契约认的字段 —— 供给侧还有 `overlayKeysByLang`
        //   （本地化工作台用），**不是判据输入**，多传会被类型门拦下。
        resourceFiles: supply.resourceFiles,
        overlayKeys: supply.overlayKeys,
      });
});
const errorCount = computed(
  () => diagnostics.value.filter((d) => d.severity === "error").length,
);
const warningCount = computed(
  () => diagnostics.value.filter((d) => d.severity === "warning").length,
);

/** 保存可用性：未绑定工程 / 只读取径 / 保存中 / 无改动 / 有错误 → 禁用（fail-closed） */
const canSave = computed(
  () =>
    saveFn.value !== undefined &&
    !saving.value &&
    dirty.value &&
    errorCount.value === 0,
);
const saveTooltip = computed(() => {
  if (saveFn.value === undefined) {
    return saveHint.value !== "" ? saveHint.value : UNBOUND_HINT;
  }
  if (errorCount.value > 0) {
    return `存在 ${errorCount.value} 个错误，先修复再保存（fail-closed）`;
  }
  if (!dirty.value) return "无未保存更改";
  return `保存到 ${projectRoot.value}`;
});

/** 编辑 API：provide 给全部视图（FieldRow/时间线/列侧栏共用一套会话提交） */
const api = {
  /** 字段/负载写入（pointer 指向字段值） */
  update(pointer: string, value: unknown): void {
    session.apply(`改 ${pointer}`, (s) => setAtPointer(s, pointer, value));
  },
  /** 删除可选字段（置空即删） */
  removeField(pointer: string): void {
    session.apply(`清 ${pointer}`, (s) => removeAtPointer(s, pointer));
  },
  /** 向数组容器插入命令或元素草稿（pointer 指向数组；缺省追加末尾；undo 标签按形态命名） */
  insertCommand(pointer: string, command: Record<string, unknown>): void {
    const what =
      typeof command.op === "string"
        ? command.op
        : `元素 ${String(command.type ?? "?")}`;
    session.apply(`插入 ${what}`, (s) => {
      const list = getAtPointer(s, pointer);
      const index = Array.isArray(list) ? list.length : 0;
      return insertAtPointer(s, pointer, index, command);
    });
  },
  removeCommand(pointer: string): void {
    session.apply(`删除 ${pointer}`, (s) => {
      const next = removeAtPointer(s, pointer);
      if (
        next !== null &&
        selectedPointer.value !== null &&
        (selectedPointer.value === pointer ||
          selectedPointer.value.startsWith(`${pointer}/`))
      ) {
        selectedPointer.value = null;
      }
      return next;
    });
  },
  moveCommand(pointer: string, delta: number): void {
    session.apply(`移动 ${pointer}`, (s) => {
      const segments = pointer.split("/");
      const index = Number(segments[segments.length - 1]);
      if (Number.isNaN(index)) return null;
      return moveAtPointer(s, pointer, index + delta);
    });
  },
  /**
   * 就地选中（**纯选中，不改视图**）。
   *
   * ⚠️ D-63 修法 (a)：此前 `select()` 背负**双重职责**——「就地选中」+
   *   「切回时间线并滚动到目标行」（后者是给诊断面板做的定位体验）。
   *   舞台视图复用它 ⇒ `pointerdown` 瞬间被切视图 ⇒ 舞台因 `v-else-if` **卸载**，
   *   拖拽的 `onMove`/`onUp` 还挂在 window 上但组件已死 ⇒ **拖拽完全不可用**。
   *   ⇒ 职责拆开：选中归 `select`，定位归 `reveal`。
   */
  select(pointer: string | null): void {
    // 诊断/引用的指针是字段级——归一到最近的命令祖先，行高亮与属性面板才有锚点
    selectedPointer.value =
      pointer === null ? null : nearestCommandPointer(story.value, pointer);
    const columnPointer = pointer?.match(/^\/columns\/(\d+)/);
    if (columnPointer !== null && columnPointer !== undefined) {
      const column = getAtPointer(story.value, columnPointer[0]) as
        { id?: string } | undefined;
      if (typeof column?.id === "string") selectedColumnId.value = column.id;
    }
  },
  /**
   * 定位揭示（**选中 + 切回时间线 + 把目标行滚到视口中央**）。
   *
   * 存在理由：点了诊断必须「看得见」——长列表/其他视图下目标行在视口外，
   * 用户感知就是「点了没反应」。**只有诊断面板与步骤图需要它**（N-2 裁定 ②）。
   */
  reveal(pointer: string): void {
    api.select(pointer);
    centerView.value = "timeline";
    void nextTick(() => {
      document
        .querySelector(".timeline .rows li.selected")
        ?.scrollIntoView({ block: "center" });
    });
  },
  /**
   * 选中列：**同时把命令指针指向列本身**（`/columns/<i>`）——
   * 舞台视图按 pointer 判定所属 scene 列；只设 selectedColumnId 会让舞台永远提示「未选中列」。
   */
  selectColumn(id: string): void {
    // 列 = 文档（单列原子文件不变量）⇒ **选列即切标签**：
    // 标签页与列树是同一份工程结构的两个面（一个按打开序、一个按列序），
    // 两者若不联动就会出现「选了一列但标签没切」的分裂。
    const path = storyDocumentPath(id);
    // 🔴 **按需打开**（2026-10-05）：工程打开时不再预开所有列（否则 62 列铺 50 个标签）。
    // 点到未开的列 ⇒ 先为它建会话，再切过去；否则 `selectedColumnId` 会指向一个
    // 没有文档的列，时间线 / 属性面板都拿不到内容。
    openColumnDocument(id);
    if (workspace.get(path) !== undefined) {
      selectDocument(path);
    }
    selectedColumnId.value = id;
    const index = (projectTree.value ?? story.value).columns.findIndex((c) => c.id === id);
    selectedPointer.value = index >= 0 ? `/columns/${index}` : null;
  },
  renameColumn(from: string, to: string): void {
    const changed = session.apply(`重命名 ${from} → ${to}`, (s) =>
      renameColumn(s, from, to),
    );
    // 分组是视图元数据，成员 id 随列改名同步（失败不影响故事编辑本身）
    if (changed) commitGrouping(renameColumnMember(grouping.value, from, to));
  },
  addColumn(
    kind: "flow" | "scene",
    hint?: string,
    /** 运行语义轴（正交）；缺省/game 不写字段 —— 判据在 `@lingfan/editor` 的 addColumn */
    type?: "game" | "menu" | "ui",
  ): void {
    // ⚠️ 新增列是**工程级**操作（改的是文件集，不是某个文件的内容）。
    // 单列文档上直接跑 `addColumn` 会产出「一个文档两列」——违反「一文档 = 一列」不变量，
    // 且保存时 `serializeColumnDocument` 会 fail-closed（恰是它兜住了，但用户会看到莫名错误）。
    // 正解：把操作施加在**整工程树**上，再把结果按列重新切分回各文档。
    const tree = projectTree.value;
    if (tree === undefined) {
      session.apply(`新增${kind === "flow" ? "流程" : "场景"}列`, (s) => {
        const result = addColumn(s, { kind, hint, type });
        selectedColumnId.value = result.id;
        return result.story;
      });
      return;
    }
    const result = addColumn(tree, { kind, hint, type });
    projectTree.value = result.story;
    redistributeDocuments(result.story);
    // 🔴 新列的文档**还没被打开过**（按需打开）⇒ 必须先建会话再切。
    //    不用 `this.selectColumn`：本对象的方法会被解构调用（`api.selectColumn`），
    //    `this` 不可靠；两行内联反而没有隐式依赖。
    openColumnDocument(result.id);
    selectDocument(storyDocumentPath(result.id));
  },
  removeColumn(id: string): void {
    // 同 addColumn：工程级操作（删的是文件）
    const tree = projectTree.value;
    if (tree === undefined) {
      if (session.apply(`删除列 ${id}`, (s) => removeColumn(s, id))) {
        syncGroupingColumns();
      }
      return;
    }
    const next = removeColumn(tree, id);
    if (next === null) return; // 未命中（列不存在）= 无事发生，不产出半个新树
    projectTree.value = next;
    redistributeDocuments(next);
    syncGroupingColumns();
  },
  /**
   * 组件拖入：元素**落点创建**（`parentPointer` = 容器元素指针 → 进 `children`，
   * 缺数组就在同一次提交里补齐）。**一次拖入 = 一个 undo 单元**；顶级创建后选中新元素
   * （属性面板立即可改），嵌套创建不改变选中（舞台视图不渲染 children）。
   */
  insertElement(
    columnPointer: string,
    element: Record<string, unknown>,
    parentPointer?: string,
  ): void {
    const type = String(element.type ?? "");
    const target =
      parentPointer === undefined
        ? `${columnPointer}/elements`
        : `${parentPointer}/children`;
    const existing = getAtPointer(story.value, target);
    const appendedAt = Array.isArray(existing) ? existing.length : 0;
    const applied = session.apply(`拖入元素 ${elementLabel(type)}`, (s) => {
      const list = getAtPointer(s, target);
      const index = Array.isArray(list) ? list.length : 0;
      const base = Array.isArray(list) ? s : setAtPointer(s, target, []);
      return insertAtPointer(base, target, index, element);
    });
    if (!applied || parentPointer !== undefined) return;
    selectedPointer.value = `${target}/${appendedAt}`;
    const column = getAtPointer(story.value, columnPointer) as
      | { id?: string }
      | undefined;
    if (typeof column?.id === "string") selectedColumnId.value = column.id;
  },
  /**
   * 节点图连线：从 `fromColumnId` 拉线到 `toColumnId` 建分支——
   * 源列最后一个 `menu` → 追加选项；否则 → 末尾追加 `jump`。
   * 语义判定在纯函数 `planBranchInsertion`（非法组合返回 false，调用方 fail-closed 提示）；
   * **一次拉线 = 一个 undo 单元**。落库后新 jump/选项由既有诊断面校验（missing-target 等）。
   */
  connectBranch(
    fromColumnId: string,
    toColumnId: string,
    optionText?: string,
  ): boolean {
    return session.apply(`连分支 ${fromColumnId} → ${toColumnId}`, (s) => {
      const index = s.columns.findIndex((c) => c.id === fromColumnId);
      if (index < 0) return null;
      const plan = planBranchInsertion(
        s.columns[index],
        toColumnId,
        optionText,
      );
      if (plan === null) return null;
      const value =
        plan.kind === "jump"
          ? { op: "jump", target: plan.target }
          : { text: plan.text ?? "新选项", target: plan.target };
      return insertAtPointer(
        s,
        `/columns/${index}/${plan.containerPointer}`,
        plan.index,
        value,
      );
    });
  },
  replaceAll(next: Story, label: string): void {
    session.commit(label, next);
    selectedPointer.value = null;
    selectedColumnId.value = next.entry;
  },
};
/* —— 应用内对话框（替代原生 prompt/confirm/alert —— D-62①） —— */
const dialogState = new DialogHostState();
const dialog = createDialogPort(dialogState);
/** 栈变化 → 驱动 DialogHost 渲染（面板只读这个 ref） */
const dialogRequest = ref(dialogState.current);
dialogState.subscribe(() => {
  dialogRequest.value = dialogState.current;
});
provide(DIALOG_PORT_KEY, dialog);

provide("editorApi", api);
/**
 * 章节树的**路径面**（列 id → 来源文件路径）。
 *
 * 章节树据此把「列」按**作者的目录编排**分组（`Stories/chapter1/chapter1.story`
 * ⇒ 章节 `chapter1`）。生产者是文档集合（`workspace`），与标签栏**同源**
 * ⇒ 不额外维护第二份路径真相。
 */
provide("columnPaths", columnPaths);
provide("selectedPointer", selectedPointer);

/**
 * 列分组 API（与 `editorApi` 分离）：**不经 session 提交**——视图偏好不产生 undo
 * 单元、不置 dirty、不进故事 JSON（列序属叙事语义，分组只是作者视图偏好）。
 */
provide("columnGroupingApi", {
  view: grouping,
  addGroup(name: string): void {
    commitGrouping(addGroup(grouping.value, name));
  },
  renameGroup(groupId: string, name: string): void {
    commitGrouping(renameGroup(grouping.value, groupId, name));
  },
  removeGroup(groupId: string): void {
    commitGrouping(removeGroup(grouping.value, groupId));
  },
  assignColumn(columnId: string, groupId: string | null): void {
    commitGrouping(assignColumn(grouping.value, columnId, groupId));
  },
  toggleCollapsed(groupId: string): void {
    commitGrouping(toggleCollapsed(grouping.value, groupId));
  },
});

function onImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  const reader = new FileReader();
  reader.onload = (): void => {
    try {
      const parsed = JSON.parse(String(reader.result)) as Story;
      api.replaceAll(parsed, `导入 ${file.name}`);
      unbindProject();
    } catch (e) {
      alert(`导入失败：${String(e)}`);
    }
  };
  reader.readAsText(file);
}

/**
 * 保存回磁盘：捕获**实际写出的那个引用**（乐观并发——await 期间用户又改，
 * 基线钉在 target 上仍 dirty，不误清）；成功后 `markSaved(target)`。
 * 保存前先做规范化检测（用户已「不再提示」则跳过检测）——有发现时**不执行**
 * 保存，展示清单等确认（跳过提示 ≠ 丢弃保存：确认/取消后状态干净）。
 */
async function onSave(): Promise<void> {
  if (saveColumnFn.value !== undefined) {
    await saveActiveDocument();
    return;
  }
  const run = saveFn.value;
  if (run === undefined || saving.value) return;
  const target = story.value;
  if (!skipNormalizationNotice.value) {
    const finding = inspectSaveFn.value?.(target);
    if (finding !== undefined) {
      const lines = describeNormalization(finding);
      if (lines.length > 0) {
        pendingSave.value = run;
        normalizationNotice.value = lines;
        saveNotice.value = ""; // 确认区取代旧成功提示，避免双提示混淆
        return;
      }
    }
  }
  await performSave(run, target);
}

/**
 * 保存**活动文档**（多文档面的正确路径）：只落该列文件。
 *
 * 与整工程 `save` 的差别不是"少写几个文件"，而是**防丢数据**：整工程路径要的是
 * 「全部标签的当前状态重组出的树」，而本路径只承诺「活动标签这一个文件」。
 * 规范化检测属于**整工程**关注点（多列文件规范化成单列），单文档路径不适用。
 */
async function saveActiveDocument(): Promise<void> {
  const run = saveColumnFn.value;
  const doc = workspace.activeDocument;
  if (run === undefined || doc === undefined || saving.value) return;
  const columnId = columnIdOfDocument(doc.path);
  // 非故事文档（媒体 / 译文表等）本批尚无写回路径 ⇒ 如实不可存，不装作能存
  if (columnId === undefined) {
    saveError.value = "该资源类型尚不支持保存（本批只落地 .story 文档写回）";
    return;
  }
  saving.value = true;
  saveError.value = "";
  saveNotice.value = "";
  const target = doc.session.story;
  try {
    const report = await run(columnId, target);
    doc.session.markSaved(target);
    documentDirty.value = new Set(workspace.dirtyPaths);
    saveNotice.value = `已保存：写入 ${report.written.length} 个文件`;
  } catch (error: unknown) {
    saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
}

/** 确认区内的实际保存（onSave 与「继续保存」共用；target 取确认时刻的当前树） */
async function performSave(
  run: (s: Story) => Promise<ProjectWriteReport>,
  target: Story,
): Promise<void> {
  saving.value = true;
  saveError.value = "";
  saveNotice.value = "";
  try {
    const report = await run(target);
    session.markSaved(target);
    saveNotice.value =
      `已保存：写入 ${report.written.length} 个文件` +
      (report.deleted.length > 0
        ? `，删除 ${report.deleted.length} 个旧文件`
        : "");
  } catch (error: unknown) {
    saveError.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
}

/** 「继续保存」：按确认时刻的当前树执行暂存的保存动作（乐观并发语义不变） */
async function confirmNormalization(): Promise<void> {
  const run = pendingSave.value;
  cancelNormalization();
  if (run === undefined || saving.value) return;
  await performSave(run, story.value);
}

/** 收起确认区（取消或已被更高优先级状态取代）；暂存的动作一并作废 */
function cancelNormalization(): void {
  pendingSave.value = undefined;
  normalizationNotice.value = [];
}

/** 「不再提示」勾选：立即落本机偏好（失败静默 = 仅本次会话有效） */
function onSkipNormalizationChange(): void {
  writeSkipNormalizationNotice(
    readLocalStorage(),
    skipNormalizationNotice.value,
  );
}

function onExport(): void {
  const blob = new Blob([JSON.stringify(story.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${story.value.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="editor-root">
    <!--
      顶栏（2026-10-04 UI 改造 步1「瘦身」）：
      原则 = **顶栏不放编辑动作**（同 VS Code）——它只回答两件事：
      「我在哪个工程」与「我在看哪个视图」。编辑/文件动作走右侧「⋯」菜单（保留快捷键），
      状态量（未保存 / 可回溯步数 / 诊断数）走底部状态栏 —— 那是**状态**不是**动作**。
      改造前：15 个子元素、仅 1 个 spacer（≈110px/个，视觉噪声高）。
    -->
    <header class="toolbar">
      <!-- 左：工程标识（品牌弱化 + 工程名/路径合并为一个 chip） -->
      <div class="tb-group tb-left">
        <strong class="brand" title="灵泛编辑器">灵泛</strong>
        <button
          class="project-chip btn-tonal"
          :title="projectChipTitle"
          @click="openProject"
        >
          <span class="project-chip-name">{{ projectRoot !== '' ? projectName : story.id }}</span>
          <span v-if="projectRoot !== ''" class="project-chip-path">{{ projectRoot }}</span>
        </button>
        <button
          v-if="props.lastProject?.value !== undefined"
          class="icon-button"
          :title="`一键重开上次工程「${props.lastProject.value.name}」`"
          :aria-label="`一键重开上次工程「${props.lastProject.value.name}」`"
          @click="reopenLastProject"
        >
          ↺
        </button>
      </div>

      <!-- 中：视图切换（居中，唯一常驻的"模式"切换） -->
      <div class="view-switch" role="tablist" aria-label="中心视图">
        <button
          role="tab"
          :aria-selected="centerView === 'timeline'"
          :class="{ active: centerView === 'timeline' }"
          @click="centerView = 'timeline'"
        >
          时间线
        </button>
        <button
          role="tab"
          :aria-selected="centerView === 'stage'"
          :class="{ active: centerView === 'stage' }"
          @click="centerView = 'stage'"
        >
          舞台
        </button>
        <button
          role="tab"
          :aria-selected="centerView === 'graph'"
          :class="{ active: centerView === 'graph' }"
          @click="centerView = 'graph'"
        >
          节点图
        </button>
        <button
          role="tab"
          :aria-selected="centerView === 'step'"
          :class="{ active: centerView === 'step' }"
          title="以「步骤」（等待态边界）为单位查看顺序与分支"
          @click="centerView = 'step'"
        >
          步骤
        </button>
      </div>

      <!-- 右：预览 + 动作溢出菜单 -->
      <div class="tb-group tb-right" @keydown="onToolMenuKeydown">
        <button class="preview-button btn-filled" @click="previewing = true">▶ 预览</button>
        <div ref="toolMenuAnchor" class="menu-anchor">
          <button
            class="icon-button"
            title="更多操作（保存 / 撤销 / 文件 / 工程）"
            aria-label="更多操作"
            :aria-expanded="toolMenuOpen"
            @click="toolMenuOpen = !toolMenuOpen"
          >
            ⋯
          </button>
          <div v-if="toolMenuOpen" class="menu" role="menu">
            <p class="menu-title">编辑</p>
            <button class="menu-item" role="menuitem" :disabled="!canSave" :title="saveTooltip" @click="onSave(); toolMenuOpen = false">
              {{ saving ? "保存中…" : "保存" }}<kbd>Ctrl+S</kbd>
            </button>
            <button class="menu-item" role="menuitem" :disabled="undoDepth === 0" @click="session.undo(); toolMenuOpen = false">
              撤销<span class="menu-hint">{{ undoDepth }} 步可回溯</span>
            </button>
            <button class="menu-item" role="menuitem" :disabled="redoDepth === 0" @click="session.redo(); toolMenuOpen = false">
              重做<span class="menu-hint">{{ redoDepth }} 步</span>
            </button>
            <p class="menu-sep" role="separator"></p>
            <p class="menu-title">工程与文件</p>
            <button class="menu-item" role="menuitem" @click="pickImport(); toolMenuOpen = false">导入 JSON…</button>
            <button class="menu-item" role="menuitem" @click="onExport(); toolMenuOpen = false">导出工程</button>
            <button class="menu-item" role="menuitem" @click="openProject(); toolMenuOpen = false">打开工程…</button>
            <p class="menu-sep" role="separator"></p>
            <p class="menu-title">危险操作</p>
            <button class="menu-item btn-danger" role="menuitem" @click="onNew(); toolMenuOpen = false">新建工程（覆盖当前）</button>
          </div>
        </div>
      </div>

      <!-- 目录 input 兜底取径（无 FSA 的浏览器 / 自动化测试）：恒在 DOM，触发点由脚本决定 -->
      <input
        ref="fallbackInput"
        class="fallback-input"
        type="file"
        webkitdirectory
        multiple
        @change="onFallbackFiles"
      />
      <input
        ref="importInput"
        class="fallback-input"
        type="file"
        accept=".json,application/json"
        @change="onImportFile"
      />
    </header>

    <p v-if="openError !== ''" class="open-error">
      {{ openError }}
      <button @click="openError = ''">关闭</button>
    </p>

    <p v-if="saveError !== ''" class="save-error">
      {{ saveError }}
      <button @click="saveError = ''">关闭</button>
    </p>

    <p v-if="saveNotice !== ''" class="save-notice">
      {{ saveNotice }}
      <button @click="saveNotice = ''">关闭</button>
    </p>

    <!-- 保存前规范化确认：清单 = describeNormalization（与真实写回行为一一对应） -->
    <div v-if="normalizationNotice.length > 0" class="save-normalization">
      <strong>首次保存将把工程文件规范化为标准布局：</strong>
      <ul>
        <li v-for="line in normalizationNotice" :key="line">{{ line }}</li>
      </ul>
      <p class="normalization-note">
        另：列文件按列 id 排序存储；Stories/ 下的空目录不会自动清理。
      </p>
      <div class="normalization-actions">
        <label>
          <input v-model="skipNormalizationNotice" type="checkbox" @change="onSkipNormalizationChange" />
          不再提示
        </label>
        <button class="save-button" :disabled="saving" @click="confirmNormalization">
          {{ saving ? "保存中…" : "继续保存" }}
        </button>
        <button :disabled="saving" @click="cancelNormalization">取消</button>
      </div>
    </div>

    <main class="workspace">
      <!-- 标签页（多文档）：一个资源 = 一个标签 = 一个独立会话（脏标记各自独立） -->
      <div class="tab-strip doc-tabs" role="tablist" aria-label="已打开的资源">
        <!-- ⚠️ 外层是 div[role=tab] 而非 button：内含关闭按钮（button 嵌 button 无效 HTML）；
             键盘通路 = tabindex + Enter（role=tab 的最小可用形态）。 -->
        <div
          v-for="path in documentPaths"
          :key="path"
          role="tab"
          class="doc-tab"
          :class="{ active: path === activeDocumentPath }"
          :aria-selected="path === activeDocumentPath"
          :title="path"
          :tabindex="path === activeDocumentPath ? 0 : -1"
          @click="selectDocument(path)"
          @keydown.enter.prevent="selectDocument(path)"
          @auxclick.middle.prevent="closeDocument(path)"
        >
          <span class="doc-tab-name">{{
            columnIdOfDocument(path) ?? path.split("/").pop() ?? path
          }}</span>
          <span
            v-if="documentDirty.has(path)"
            class="dirty-dot"
            title="有未保存的更改"
            aria-label="有未保存的更改"
          ></span>
          <button
            class="doc-tab-close"
            title="关闭标签（中键同）"
            :aria-label="`关闭 ${columnIdOfDocument(path) ?? path}`"
            @click.stop="closeDocument(path)"
          >
            ✕
          </button>
        </div>
        <!-- 步3「文档标签补全」：新建入口。
             ⚠️ 绑的是 **新增流程列**（文档级，与 tab 同级），
                **不是** `onNew`（那是「新建整个工程」，会把工程重置为示例）——
                我先绑错、真机点下去没反应才查出来。 -->
        <button
          class="doc-tab-add"
          title="新增流程列"
          aria-label="新增流程列"
          @click="addFlowColumn"
        >
          +
        </button>
      </div>

      <div class="workspace-body">
        <!--
          侧栏（2026-10-04 UI 改造 步2「收纳去重」）：
          **原活动栏已删** —— 它的三项（资源 / 搜索 / 最近）与左栏 tab **完全重复**
          （实测同一功能两个入口）。功能全部保留在左栏 tab（5 项：资源/搜索/最近/列/组件）。
          窄条 27px 挤着「资 源」竖排文字的观感问题随之消失。
        -->

        <!-- 侧栏：可拖宽 / 可折叠 -->
        <aside
          v-show="!layout.leftCollapsed"
          class="pane columns-pane"
          :style="{ width: `${layout.leftWidth}px` }"
        >
          <div class="tab-strip left-tabs" role="tablist" aria-label="侧栏视图">
            <button
              v-for="tab in LEFT_TABS"
              :key="tab.id"
              role="tab"
              :aria-selected="leftTab === tab.id"
              :class="{ active: leftTab === tab.id }"
              :title="tab.hint"
              @click="leftTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <input
            v-if="leftTab === 'search'"
            v-model="searchKeyword"
            class="side-search"
            type="search"
            placeholder="搜索资源名或路径…"
            aria-label="搜索资源"
          />
          <div v-show="leftTab === 'resources'" class="left-pane-body">
            <!-- 收展持久化只接资源模式实例：搜索/最近是扁平列表，无折叠面 -->
            <ResourceTreeView
              :nodes="resourceNodes"
              :active-path="resourceFocusPath"
              :project-id="story.id"
              @open="openResource"
            />
          </div>
          <div v-show="leftTab === 'search'" class="left-pane-body">
            <!-- 内容搜索结果（先于名称匹配，因为它更精确） -->
            <ul v-if="searchReport.hits.length > 0" class="hits">
              <li v-for="(hit, i) in searchReport.hits" :key="`${hit.path}:${hit.line}:${i}`">
                <button class="hit" :title="`${hit.path}:${hit.line}`" @click="openResource(hit.path)">
                  <span class="hit-path">{{ hit.path }}<span class="hit-line">:{{ hit.line }}</span></span>
                  <span class="hit-text">{{ hit.text.trim().slice(0, 80) }}</span>
                </button>
              </li>
            </ul>
            <p v-if="searchReport.truncated" class="hits-more">已达上限，还有更多结果</p>
            <p v-if="searchKeyword.trim() !== '' && searchReport.searchedFiles > 0 && searchReport.hits.length === 0" class="hits-none">
              内容中无匹配
            </p>
            <ResourceTreeView
              :nodes="resourceNodes"
              :active-path="workspace.activePath"
              :filter="searchFilter"
              @open="openResource"
            />
          </div>
          <div v-show="leftTab === 'recent'" class="left-pane-body">
            <ResourceTreeView
              :nodes="resourceNodes"
              :active-path="workspace.activePath"
              :filter="recentFilter"
              @open="openResource"
            />
          </div>
          <!-- v-show 必须落在**单根元素**上：ColumnList 是多根模板，直接给它 v-show 会让指令失效
               （Vue: "Runtime directive used on component with non-element root node"）⇒ 命令面板不会隐藏 -->
          <!-- **章节树**（2026-10-05 接线）：内容骨架是「章节」而不是文件——
               真实工程 `Stories/chapter1/chapter1.story`、`Stories/system/about.story`
               都是作者的编排，平铺 50 个文档会让人失去结构感。
               ① 取**整工程树**（喂单列切片则只剩一列，用户失去「工程里有哪些列」的视野）
               ② 路径面经 `columnPaths` 注入（章节 = 路径目录）
               ③ 选列 = 切标签（`api.selectColumn` 内部完成，同一动作不重复实现） -->
          <div v-show="leftTab === 'chapters'" class="left-pane-body">
            <!-- 常驻说明（2026-10-05）：「章节」与「列」都是"工程里的列"，光看名字分不出区别。
                 tab 的 `title` 只在悬停时可见 ⇒ 面板顶部给一行**常驻**口径说明。 -->
            <p class="left-pane-note">按文件路径分章（目录即章节）</p>
            <ChapterTree :story="projectTree ?? story" :selected-id="selectedColumnId" />
          </div>
          <!-- v-show 必须落在**单根元素**上：ColumnList 是多根模板，直接给它 v-show 会让指令失效
               （Vue: "Runtime directive used on component with non-element root node"）⇒ 命令面板不会隐藏 -->
          <div v-show="leftTab === 'columns'" class="left-pane-body">
            <!-- 常驻说明（与「章节」对称）：说清这一页是**作者手动分组**，与目录结构无关 -->
            <p class="left-pane-note">按手动分组排列（与目录无关）</p>
            <!-- 列树取**整工程树**（工程级视图）：活动文档是单列切片，
                 若喂切片则列树只剩一列，用户失去「工程里有哪些列」的视野。
                 选列 = 切标签（`api.selectColumn` 内部完成，两者同一动作不重复实现）。 -->
            <ColumnList :story="projectTree ?? story" :selected-id="selectedColumnId" />
          </div>
          <div v-show="leftTab === 'palette'" class="left-pane-body">
            <ComponentPalette />
          </div>
        </aside>
        <PaneSplitter
          v-if="!layout.leftCollapsed"
          :size="layout.leftWidth"
          :min="MIN_SIDEBAR_WIDTH"
          :max="MAX_SIDEBAR_WIDTH"
          side="left"
          label="调整侧栏宽度"
          @resize="setLeftWidth"
        />

      <section class="pane center-pane">
        <!-- 首屏空态（E5 重定）：**未打开工程时不假装有工程** ——
             内存示例故事只是"可试玩"，不是"你的工程"。主动作是「打开工程」。 -->
        <EmptyState
          v-if="!projectRoot && activeResource === undefined && documentPaths.length <= 1 && !dirty"
          reason="no-project"
          @action="onEmptyAction"
        />

        <!-- 非故事资源：按分派表走专用视图（译文表 / 清单 / 媒体 / 只读） -->
        <LangView
          v-else-if="activeSpec.view === 'lang' && activeSource !== undefined"
          :key="activePath"
          :path="activePath"
          :source="activeSource"
          @save="saveTextResource"
        />
        <JsonResourceView
          v-else-if="activeSpec.view === 'manifest' && activeSource !== undefined"
          :key="activePath"
          :path="activePath"
          :title="activeSpec.title"
          :source="activeSource"
          @save="saveTextResource"
        />
        <MediaView
          v-else-if="activeSpec.view === 'media'"
          :key="activePath"
          :path="activePath"
          :kind="activeMediaKind"
          :resource-port="resourcePort"
        />
        <ReadOnlyView
          v-else-if="activeSpec.view === 'readonly'"
          :path="activePath"
          :reason="activeReadOnlyReason"
        />
        <!-- 读取失败：如实展示（此前 readError 只收集不渲染 ⇒ 失败被静默成空白） -->
        <p v-else-if="readError" class="center-error">{{ readError }}</p>
        <p v-else-if="activeSpec.view !== 'story'" class="center-loading">正在读取资源…</p>

        <!-- 故事资源：四视图仍是它的内部切面（不是四类资源） -->
        <template v-else-if="centerView === 'timeline'">
          <StoryTimeline
            :story="story"
            :column-id="selectedColumnId"
            :selected-pointer="selectedPointer"
          />
        </template>
        <StageEditor
          v-else-if="centerView === 'stage'"
          :story="story"
          :pointer="selectedPointer"
          :resource-port="resourcePort"
          :first-scene-column-id="firstSceneColumnId"
        />
        <!-- key = story.id ⇒ 换工程/新建/导入必重挂载，布局缓存从新工程的存储键重读 -->
        <NodeGraph
          v-else-if="centerView === 'graph'"
          :key="story.id"
          :story="story"
          :selected-id="selectedColumnId"
        />
        <!-- 步骤视图：确定性排布（无布局缓存）——key 仅用于换工程时归零选中态派生 -->
        <StepLayout
          v-else-if="centerView === 'step'"
          :key="story.id"
          :story="story"
          :selected-id="selectedColumnId"
        />
      </section>

      <aside
        v-show="!layout.rightCollapsed"
        class="pane right-pane"
        :style="{ width: `${layout.rightWidth}px` }"
      >
        <!-- a11y（#8）：tablist 语义 —— 此前右栏与左栏的 tab 都是裸 button
             （读屏只知道「6 个按钮」，不知道它们是互斥视图切换）。 -->
        <div class="tab-strip" role="tablist" aria-label="右栏面板">
          <button
            role="tab"
            :aria-selected="rightTab === 'property'"
            :class="{ active: rightTab === 'property' }"
            @click="rightTab = 'property'"
          >
            属性
          </button>
          <button
            role="tab"
            :aria-selected="rightTab === 'diagnostics'"
            :class="{ active: rightTab === 'diagnostics' }"
            @click="rightTab = 'diagnostics'"
          >
            诊断
          </button>
          <button
            role="tab"
            :aria-selected="rightTab === 'json'"
            :class="{ active: rightTab === 'json' }"
            @click="rightTab = 'json'"
          >
            JSON
          </button>
          <button
            role="tab"
            :aria-selected="rightTab === 'text'"
            :class="{ active: rightTab === 'text' }"
            @click="rightTab = 'text'"
          >
            文本
          </button>
          <!-- 本地化工作台（聚合面：多语言覆盖率 / 缺译清单 / 骨架生成） -->
          <button
            role="tab"
            :aria-selected="rightTab === 'i18n'"
            :class="{ active: rightTab === 'i18n' }"
            title="本地化：多语言覆盖率与译文表骨架"
            @click="rightTab = 'i18n'"
          >
            本地化
          </button>
          <!-- 🔴 出餐**不再是右栏 tab**（#10 下沉，2026-10-05）：打包是低频动作（以分钟计），
               不占一级 tab；入口移到**状态栏**（带文字标签按钮，toggle 出餐页）。 -->
        </div>
        <!-- 🔴 属性面板**已移入右栏**（#8）：中央时间线拿回全部高度
             （实测旧布局中央属性面板 188px 高、下方 483px 空）。 -->
        <PropertyPanel
          v-show="rightTab === 'property'"
          :story="story"
          :pointer="selectedPointer"
        />
        <DiagnosticsPanel
          v-show="rightTab === 'diagnostics'"
          :diagnostics="diagnostics"
        />
        <JsonView v-show="rightTab === 'json'" :story="story" />
        <TextModeView v-show="rightTab === 'text'" :story="story" />
        <!-- 本地化工作台：数据全部来自既有诊断供给（**零新增 IO**） -->
        <LangWorkbench
          v-show="rightTab === 'i18n'"
          :sources="i18nSources"
          :langs="i18nLangs"
          @open="openResource"
          @generate="generateLangSkeleton"
        />
        <!-- 快速出餐：**前端不 spawn 进程**，只转发给本地宿主 -->
        <PackPanel
          v-show="rightTab === 'pack'"
          :can-pack="localHostAvailable"
          :send="sendPackRequest"
        />
      </aside>
      <PaneSplitter
        v-if="!layout.rightCollapsed"
        :size="layout.rightWidth"
        :min="MIN_RIGHT_WIDTH"
        :max="MAX_RIGHT_WIDTH"
        side="right"
        label="调整属性栏宽度"
        @resize="setRightWidth"
      />
      </div>
    </main>

    <StatusBar
      v-if="layout.statusBar"
      :root="projectRoot"
      :local-host="localHostAvailable"
      :document-count="workspace.documents.length"
      :dirty-count="workspace.dirtyCount"
      :error-count="errorCount"
      :warning-count="warningCount"
      :packing="packing"
      :pack-active="rightTab === 'pack'"
      :degraded="degradedOpen"
      @toggle-pack="togglePackPane"
    />

    <!-- 「宿主未启动」非阻塞横幅：`pointer-events:none` ⇒ 绝不拦点击（模态遮罩的老坑） -->
    <div v-if="hostHint" class="host-hint" role="status">
      <span class="host-hint-text">
        未检测到本地宿主 —— 绝对路径 / 外部打开 / 一键打包 / 热重载**不可用**（其余功能正常）。
        启用：<code>pnpm editor:dev</code>
      </span>
      <button
        class="host-hint-x"
        title="知道了"
        aria-label="关闭提示"
        @click="hostHint = false"
      >
        ✕
      </button>
    </div>

    <!-- 对话框宿主：渲染 `dialogRequest`（栈顶），并在回答后回抛 -->
    <DialogHost
      :request="dialogRequest"
      @answer="(v) => dialogState.answer(v as string | boolean | null | undefined)"
      @dismiss="dialogRequest = dialogState.current"
    />

    <PreviewHost
      v-if="previewing"
      :story="story"
      :resource-port="resourcePort"
      :layer-z="layerZ"
      :create-audio-port="createAudioPort"
      :create-video-port="createVideoPort"
      @close="previewing = false"
    />
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--lf-surface-base);
  color: var(--lf-text-primary);
  font-size: var(--lf-font-lg);
}
button {
  background: var(--lf-border-subtle);
  color: var(--lf-text-primary);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  padding: 4px 10px;
  cursor: pointer;
  font-size: var(--lf-font-md);
  /* 标签不折行：中文按钮文案被拆到两行会撑高工具栏（D-62④ 的直接成因之一） */
  white-space: nowrap;
  transition:
    background var(--lf-transition-fast),
    border-color var(--lf-transition-fast),
    color var(--lf-transition-fast);
}
/* 交互态（D-62③）：此前**全局零 `button:hover`**，只有各组件自订的 class 级 hover ⇒
   顶栏/标签栏等裸 button 完全没有反馈。统一在基类补齐，组件级仍可覆盖。 */
button:hover:not(:disabled) {
  /* 底色用 `--lf-surface-hover-strong`（≠ 基类底色）：此前用 `--lf-surface-selected`
     与 button 基类的 `--lf-border-subtle` **同值 #24283b** ⇒ hover 只改到边框，
     背景看起来毫无反应（实测撞色）。 */
  background: var(--lf-surface-hover-strong);
  border-color: var(--lf-border-focus);
}
button:active:not(:disabled) {
  background: var(--lf-surface-active);
  border-color: var(--lf-accent);
}
/* 焦点态用 `:focus-visible`（鼠标点击不亮、键盘 Tab 才亮 —— 避免"点了也冒一圈"的噪声） */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--lf-accent);
  outline-offset: 1px;
  border-color: var(--lf-accent);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
input,
select,
textarea {
  background: var(--lf-surface-overlay);
  color: var(--lf-text-primary);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-sm);
  padding: 3px 6px;
  font-size: var(--lf-font-md);
  transition: border-color var(--lf-transition-fast);
}
input:hover:not(:disabled),
select:hover:not(:disabled),
textarea:hover:not(:disabled) {
  border-color: var(--lf-border-focus);
}
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.toolbar {
  display: grid;
  /* 三段式：工程标识 | 视图切换（真居中）| 动作 —— 步1 瘦身后的骨架。
     ⚠️ 用 grid 而非 flex+spacer：flex 的"居中"其实是"两侧等宽"的假居中，
     左侧内容变多时视图切换就会偏 —— grid 三段才能真居中。 */
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  min-height: 40px;
  background: var(--lf-surface-overlay);
  border-bottom: 1px solid var(--lf-border-subtle);
  flex-wrap: wrap;
  row-gap: 6px;
}
.tb-group {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tb-right {
  justify-content: flex-end;
}
.brand {
  font-size: var(--lf-font-md);
  font-weight: 500;
  color: var(--lf-accent);
  letter-spacing: 0.04em;
}
/* 工程标识 chip：名称 + 路径两行，主次分明（替代原来并排的 story-id / project-root） */
.project-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  min-width: 0;
  max-width: 30ch;
  padding: 2px 8px;
  line-height: 1.25;
  background: transparent;
  border-color: transparent;
}
.project-chip:hover:not(:disabled) {
  background: var(--lf-surface-hover-strong);
  border-color: var(--lf-border-subtle);
}
.project-chip-name {
  font-size: var(--lf-font-md);
  color: var(--lf-text-primary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-chip-path {
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl; /* 路径尾部更有信息量 ⇒ 从左截断 */
  text-align: left;
}
.icon-button {
  padding: 2px 8px;
  font-size: var(--lf-font-lg);
  line-height: 1.2;
  color: var(--lf-text-secondary);
  background: transparent;
  border-color: transparent;
}
.icon-button:hover:not(:disabled) {
  color: var(--lf-text-primary);
  background: var(--lf-surface-hover-strong);
  border-color: var(--lf-border-subtle);
}

/* 视图切换：Material 风格 —— 活动项用**填充 chip**（非描边），组内聚拢 */
.view-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--lf-surface-sunken);
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-lg);
}
.view-switch button {
  padding: 3px 12px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
  background: transparent;
  border-color: transparent;
  border-radius: var(--lf-radius-md);
}
.view-switch button:hover:not(.active) {
  color: var(--lf-text-primary);
  background: var(--lf-surface-hover);
}
.view-switch button.active {
  color: var(--lf-text-primary);
  background: var(--lf-surface-selected);
  border-color: var(--lf-border-focus);
}

/* 动作溢出菜单 */
.menu-anchor {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  padding: 4px;
  background: var(--lf-surface-overlay);
  border: 1px solid var(--lf-border-focus);
  border-radius: var(--lf-radius-lg);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.5);
}
.menu-title {
  margin: 4px 8px 2px;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--lf-border-subtle);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  font-size: var(--lf-font-md);
  text-align: left;
  color: var(--lf-text-primary);
  background: transparent;
  border-color: transparent;
  border-radius: var(--lf-radius-sm);
}
.menu-item:hover:not(:disabled) {
  background: var(--lf-surface-hover-strong);
  border-color: transparent;
}
.menu-item kbd {
  margin-left: auto;
  padding: 0 4px;
  font-family: var(--lf-font-mono);
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
  background: var(--lf-surface-sunken);
  border-radius: var(--lf-radius-sm);
}
.menu-hint {
  margin-left: auto;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
/* 按钮三档语义（Material：filled 主 / tonal 次 / danger 危险）
   —— 关键：**主按钮在同屏内应当唯一**，否则视觉焦点散掉。 */
.btn-filled {
  color: var(--lf-text-inverse);
  background: var(--lf-accent);
  border-color: var(--lf-accent);
}
.btn-filled:hover:not(:disabled) {
  background: color-mix(in srgb, var(--lf-accent) 86%, white);
  border-color: color-mix(in srgb, var(--lf-accent) 86%, white);
}
.btn-tonal {
  color: var(--lf-text-secondary);
  background: var(--lf-surface-hover);
  border-color: transparent;
}
.btn-tonal:hover:not(:disabled) {
  color: var(--lf-text-primary);
  background: var(--lf-surface-hover-strong);
}
.btn-danger {
  color: var(--lf-danger);
  background: transparent;
  border-color: color-mix(in srgb, var(--lf-danger) 40%, transparent);
}
.btn-danger:hover:not(:disabled) {
  background: var(--lf-danger-surface);
}
/* 「预览」= 同屏主动作 ⇒ filled（底色由 `.btn-filled` 给）。
   ⚠️ 此处**不再设 background** —— 同特异性的 `.preview-button` 若也设背景会
   覆盖 `.btn-filled`（靠后者胜出），主按钮就没有实底色了（实测 transparent）。 */
.preview-button {
  color: var(--lf-text-inverse);
  border-color: var(--lf-accent);
}
.brand {
  color: var(--lf-accent);
}
.story-id {
  color: var(--lf-text-hint);
}
.open-button {
  color: var(--lf-accent);
  border-color: color-mix(in srgb, var(--lf-accent) 40%, transparent);
}
.project-root {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
  /* 长路径是顶栏最占宽的一项 ⇒ 允许收缩 + 省略号，完整值在 title 里。
     不这么做：一条长路径会把右侧所有按钮整体挤到第二行（D-62④ 主因）。 */
  min-width: 0;
  max-width: 34ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 目录 input 兜底取径：不进布局，但必须在 DOM 里（脚本可触发） */
.fallback-input {
  display: none;
}
.open-error,
.save-error,
.save-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 12px;
}
.open-error,
.save-error {
  color: var(--lf-danger);
  border-bottom: 1px solid color-mix(in srgb, var(--lf-danger) 27%, transparent);
  background: var(--lf-danger-tint);
}
.save-notice {
  color: var(--lf-success);
  border-bottom: 1px solid color-mix(in srgb, var(--lf-success) 27%, transparent);
  background: var(--lf-success-tint);
}
.save-normalization {
  border-bottom: 1px solid color-mix(in srgb, var(--lf-warning) 27%, transparent);
  background: var(--lf-warning-tint);
  color: var(--lf-warning);
  padding: 8px 12px;
  font-size: var(--lf-font-md);
}
.save-normalization ul {
  margin: 6px 0;
  padding-left: 20px;
}
.save-normalization .normalization-note {
  margin: 4px 0;
  color: var(--lf-text-hint);
}
.save-normalization .normalization-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.save-button {
  color: var(--lf-success);
  border-color: color-mix(in srgb, var(--lf-success) 40%, transparent);
}
.dirty-dot {
  color: var(--lf-warning);
  font-size: var(--lf-font-sm);
}
.undo-hint {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
}
.spacer {
  flex: 1;
}
.diag-badge.has-error {
  color: var(--lf-danger);
  border-color: color-mix(in srgb, var(--lf-danger) 53%, transparent);
}
.view-switch button.active {
  color: var(--lf-accent);
  border-color: var(--lf-accent);
}
.preview-button {
  color: var(--lf-success);
  border-color: color-mix(in srgb, var(--lf-success) 40%, transparent);
}
.file-button {
  background: var(--lf-border-subtle);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  padding: 4px 10px;
  cursor: pointer;
  font-size: var(--lf-font-md);
}
.file-button input {
  display: none;
}
.workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 8px;
  gap: 8px;
}
/* 主体行：活动栏 + 侧栏 + 分栏条 + 中心 + 分栏条 + 右栏 */
.workspace-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
}
/* 侧栏 / 右栏宽度由 JS 内联（可拖 + 可持久化）⇒ 这里只给收缩与溢出口径 */
.columns-pane,
.right-pane {
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
}
.center-pane {
  flex: 1 1 auto;
  min-width: 0;
}
.side-search {
  margin: 0 8px 6px;
  width: calc(100% - 16px);
  font-size: var(--lf-font-md);
}
/* 标签页：横跨三栏（列 1/-1），自身不参与三栏宽度分配 */
.doc-tabs {
  grid-column: 1 / -1;
  display: flex;
  align-items: stretch;
  gap: 4px;
  overflow-x: auto;
  min-height: 30px;
}
.doc-tab {
  /* 步3：标签改 **无框 + 下划线**（Material/浏览器式）——
     原先每个标签都是「描边 + 底色」的卡片，5 个并排时视觉噪声高。 */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  white-space: nowrap;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  color: var(--lf-text-secondary);
  cursor: pointer; /* div[role=tab] 不带 button 的默认手型，显式给 */
  user-select: none;
}
.doc-tab:hover:not(.active) {
  background: var(--lf-surface-hover);
  color: var(--lf-text-primary);
  border-bottom-color: var(--lf-border-subtle);
}
.doc-tab.active {
  background: transparent;
  color: var(--lf-text-primary);
  /* 活动态 = **下划线**（而非整块底色）：弱化标签框、强化"当前在哪" */
  border-bottom-color: var(--lf-accent);
}
/* 新建入口：与标签同高但弱化（它是"动作"不是"内容"） */
.doc-tab-add {
  flex: none;
  padding: 5px 10px;
  font-size: var(--lf-font-lg);
  line-height: 1;
  color: var(--lf-text-hint);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
}
.doc-tab-add:hover {
  color: var(--lf-text-primary);
  background: var(--lf-surface-hover);
  border-bottom-color: var(--lf-border-subtle);
}
.doc-tab-name {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: var(--lf-font-md);
}
/* 关闭按钮：常显低强调（E2 纪律——hover-only 对触屏等于不存在），hover 才转 danger */
.doc-tab-close {
  padding: 0 3px;
  font-size: var(--lf-font-sm);
  line-height: 16px;
  color: var(--lf-text-hint);
  background: transparent;
  border: none;
  border-radius: var(--lf-radius-sm);
}
.doc-tab-close:hover {
  color: var(--lf-danger);
  background: var(--lf-danger-surface, var(--lf-surface-hover));
}
.pane {
  /* 步5「描边弱化」：Material 靠**填充差**表达层级，不是每块都描边。
     描边保留但取最弱档（--lf-border-subtle），让相邻面板靠底色差区分。 */
  background: var(--lf-surface-raised);
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-md);
  padding: 10px;
  overflow: auto;
  min-height: 0;
}
.columns-pane h2,
.pane h2 {
  margin: 0 0 8px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.center-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.right-pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 诊断条目含长资源逻辑路径（如 `unused-translation` 指向 Stories 下的深层键）——
     无换行点时会把 320px 的栏撑成整行宽、逐字竖排。强制任意处可断。 */
  overflow-wrap: anywhere;
  min-width: 0;
}
/* #8 属性面板入右栏的**功能前提**（非重设计）：面板原在中央随内容自然流，
   右栏 `overflow:hidden` 会把长表单（say 全字段）裁掉 ⇒ 接管剩余高度并自滚。 */
.right-pane :deep(.property-panel) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.tab-strip {
  display: flex;
  gap: 4px;
}
.tab-strip button.active {
  border-color: var(--lf-accent);
  color: var(--lf-accent);
}
/* 左栏 tab（列 / 组件）：紧凑一行，下方内容各自滚动 */
.left-tabs {
  margin-bottom: 8px;
}
.left-tabs button {
  flex: 1;
}
/* 面板顶部**常驻**口径说明（与 tab 的 `title` 互补：那个要悬停才见）
   ⚠️ 不给背景色/边框：它只是**一行小字**，不该抢内容的视觉焦点 */
.left-pane-note {
  margin: 0 0 6px;
  padding: 0 10px;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
</style>
<style>
/* 内容搜索结果列表（侧栏内，与资源树同底色但用左边框区分） */
.hits {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  border-left: 2px solid var(--lf-border-subtle);
}
.hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 3px 8px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.hit:hover {
  background: var(--lf-surface-hover);
}
.hit-path {
  font-size: var(--lf-font-xs);
  color: var(--lf-accent);
  font-family: Consolas, monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.hit-line {
  color: var(--lf-text-hint);
}
.hit-text {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.hits-more,
.hits-none {
  margin: 0 0 6px;
  padding: 2px 8px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-style: italic;
}
.hits-more {
  color: var(--lf-warning);
}
/* 「宿主未启动」横幅：绝对不能挡交互（`pointer-events:none`），只挡自身那一条 */
.host-hint {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(680px, calc(100% - 24px));
  padding: 4px 8px 4px 10px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  background: var(--lf-surface-overlay);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  pointer-events: none; /* 关键：横幅本身不吃点击 */
}
.host-hint-text {
  overflow-wrap: anywhere;
}
.host-hint code {
  padding: 0 4px;
  font-family: var(--lf-font-mono);
  color: var(--lf-accent);
}
.host-hint-x {
  flex: none;
  padding: 0 4px;
  line-height: 1.2;
  pointer-events: auto; /* 只让关闭按钮可点 */
}

.center-error {
  padding: 16px;
  font-size: var(--lf-font-md);
  line-height: 1.6;
  color: var(--lf-danger);
  overflow-wrap: anywhere;
}
.center-loading {
  padding: 16px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-hint);
  font-style: italic;
}
</style>
