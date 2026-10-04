<script setup lang="ts">
import {
  computed,
  nextTick,
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
  type AnalyzeOptions,
  type ColumnGroupingView,
  type KeyValueStorage,
} from "@lingfan/editor";
import { sampleStory } from "./sample";
import ColumnList from "./components/ColumnList.vue";
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
import ActivityBar from "./components/ActivityBar.vue";
import DialogHost from "./components/DialogHost.vue";
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
import { detectLocalHost, type LocalHostEndpoint } from "./localHost";
import { searchResources, type SearchCorpus } from "./search";
import type { EmptyAction } from "./viewState";

import {
  createLayoutStore,
  MAX_RIGHT_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_RIGHT_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type LayoutState,
  type SidebarMode,
} from "./layout";
import {
  buildResourceTree,
  flattenResources,
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
const rightTab = ref<"diagnostics" | "json" | "text">("diagnostics");
const centerView = ref<"timeline" | "stage" | "graph" | "step">("timeline");
/** 侧栏内页（活动栏的三个投影 + 故事编辑器专属的两个内页，同一面板内切） */
type LeftTab = "resources" | "search" | "recent" | "columns" | "palette";
const LEFT_TABS: readonly { id: LeftTab; label: string }[] = [
  { id: "resources", label: "资源" },
  { id: "search", label: "搜索" },
  { id: "recent", label: "最近" },
  { id: "columns", label: "列" },
  { id: "palette", label: "组件" },
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
function setSidebarMode(mode: SidebarMode): void {
  layout.sidebar = mode;
  persistLayout();
  // 活动栏切模式 ⇒ 侧栏内页同步（同一份工程树的三个投影，不是三套数据）
  if (mode === "search" || mode === "recent" || mode === "resources") {
    leftTab.value = mode;
    layout.leftCollapsed = false;
  }
}

/**
 * 诊断供给侧：打开工程才注入（`resourceFiles` / `overlayKeys`）。
 * 未打开 = `undefined` ⇒ `analyzeStory` 收到空 options，两个检查器族整体跳过（不误报）。
 */
const diagnosticSupply = ref<Required<AnalyzeOptions> | undefined>(undefined);

/* ——— 资源树（工程维度，资源管理器的主体面） ——— */
/** 工程资源集（逻辑路径）——由诊断供给侧顺带供给，零新增 IO */
const resourcePaths = computed<readonly string[]>(() =>
  [...(diagnosticSupply.value?.resourceFiles ?? [])].sort(),
);
const resourceNodes = computed<readonly ResourceNode[]>(() =>
  buildResourceTree(resourcePaths.value),
);
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
const sidebarCounts = computed(() => ({
  resources: resourcePaths.value.length,
  search: searchKeyword.value.trim() === "" ? 0 : flattenResources(resourceNodes.value).filter(searchFilter).length,
  recent: workspace.documents.length,
}));

/** 宿主能力探测：本地服务在不在（决定「外部编辑器打开」等动作是否可做） */
const localHost = ref<LocalHostEndpoint | undefined>(undefined);
const localHostAvailable = computed(() => localHost.value !== undefined);
void (async () => {
  // 能力探测：命中 ⇒ 完整体验（外部打开 / 原生枚举）；未命中 ⇒ 浏览器形态（**正常**路径）
  const baseUrl = await detectLocalHost();
  localHost.value = baseUrl === undefined ? undefined : { baseUrl };
})();

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

/** 打开资源：按分派表路由到对应视图（未命中 ⇒ 只读，不报错） */
function openResource(path: string): void {
  const kind = kindOfPath(path);
  const spec = viewOfKind(kind);
  if (spec.view === "story") {
    const columnId = columnIdOfDocument(path);
    if (columnId === undefined) return;
    if (workspace.get(path) !== undefined) {
      selectDocument(path);
    } else {
      // 工程里已存在的列但未打开 ⇒ 打开它（真实单列文档，从整工程树切出）
      const column = (projectTree.value ?? story.value).columns.find((c) => c.id === columnId);
      if (column === undefined) return;
      workspace.open(path, "story", {
        ...(projectTree.value ?? story.value),
        entry: columnId,
        columns: [column],
      });
      selectDocument(path);
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
const previewing = ref(false);
/** 已打开工程：资源供给端口（未打开 = undefined → 预览不解析资源，维持示例语义） */
const resourcePort = ref<ResourcePort | undefined>(undefined);
/** 已打开工程的资源根名（界面显示；空 = 示例故事） */
const projectRoot = ref("");
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

/** 标签页（文档集合）变更 → 活动文档可能已变 ⇒ 重绑 + 刷新文档态派生 */
workspace.subscribe(() => {
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
    if (doc === undefined) {
      workspace.open(path, "story", {
        ...tree,
        entry: column.id,
        columns: [column],
      });
      continue;
    }
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
  for (const column of tree.columns) {
    workspace.open(storyDocumentPath(column.id), "story", {
      ...tree,
      entry: column.id,
      columns: [column],
    });
  }
  // 标签顺序 = 列序（= 文件路径码元序，叙事语义）⇒ 重排即改语义，故显式按列序复位
  const ordered = tree.columns.map((column) => storyDocumentPath(column.id));
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
  resourcePort.value = undefined;
  layerZ.value = DEFAULT_LAYER_Z; // 解绑后回内建层级表
  diagnosticSupply.value = undefined; // 解绑后回「无供给侧」= 检查器族跳过
  projectTree.value = undefined; // 诊断基准随之归零（回落到当前活动树）
  saveError.value = "";
  saveNotice.value = "";
  cancelNormalization(); // 解绑 = 保存能力消失，暂存的确认一并作废
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
const diagnostics = computed(() => {
  const tree = projectTree.value ?? story.value;
  const supply = diagnosticSupply.value;
  return supply === undefined
    ? analyzeStory(tree)
    : analyzeStory(tree, {
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
  addColumn(kind: "flow" | "scene", hint?: string): void {
    // ⚠️ 新增列是**工程级**操作（改的是文件集，不是某个文件的内容）。
    // 单列文档上直接跑 `addColumn` 会产出「一个文档两列」——违反「一文档 = 一列」不变量，
    // 且保存时 `serializeColumnDocument` 会 fail-closed（恰是它兜住了，但用户会看到莫名错误）。
    // 正解：把操作施加在**整工程树**上，再把结果按列重新切分回各文档。
    const tree = projectTree.value;
    if (tree === undefined) {
      session.apply(`新增${kind === "flow" ? "流程" : "场景"}列`, (s) => {
        const result = addColumn(s, { kind, hint });
        selectedColumnId.value = result.id;
        return result.story;
      });
      return;
    }
    const result = addColumn(tree, { kind, hint });
    projectTree.value = result.story;
    redistributeDocuments(result.story);
    selectedColumnId.value = result.id;
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
    <header class="toolbar">
      <strong class="brand">灵泛编辑器</strong>
      <span class="story-id">{{ story.id }}</span>
      <button class="open-button" title="打开真实工程目录" @click="openProject">
        打开工程
      </button>
      <button
        v-if="props.lastProject?.value !== undefined"
        :title="`一键重开上次工程「${props.lastProject.value.name}」（读权限按需申请）`"
        @click="reopenLastProject"
      >
        重新打开上次工程：{{ props.lastProject.value.name }}
      </button>
      <span v-if="projectRoot !== ''" class="project-root" title="已打开工程的资源根">
        {{ projectRoot }}
      </span>
      <button
        class="save-button"
        :disabled="!canSave"
        :title="saveTooltip"
        @click="onSave"
      >
        {{ saving ? "保存中…" : "保存" }}
      </button>
      <span v-if="dirty" class="dirty-dot" title="有未保存的更改">
        ● 未保存
      </span>
      <button
        :disabled="undoDepth === 0"
        title="撤销（Ctrl+Z）"
        @click="session.undo()"
      >
        撤销
      </button>
      <button :disabled="redoDepth === 0" title="重做" @click="session.redo()">
        重做
      </button>
      <span class="undo-hint">{{ undoDepth }} 步可回溯</span>
      <span class="spacer"></span>
      <span class="view-switch">
        <button
          :class="{ active: centerView === 'timeline' }"
          @click="centerView = 'timeline'"
        >
          时间线
        </button>
        <button
          :class="{ active: centerView === 'stage' }"
          @click="centerView = 'stage'"
        >
          舞台
        </button>
        <button
          :class="{ active: centerView === 'graph' }"
          @click="centerView = 'graph'"
        >
          节点图
        </button>
        <button
          :class="{ active: centerView === 'step' }"
          @click="centerView = 'step'"
          title="以「步骤」（等待态边界）为单位查看顺序与分支"
        >
          步骤
        </button>
      </span>
      <button
        class="diag-badge"
        :class="{ 'has-error': errorCount > 0 }"
        title="诊断（编辑期 fail-closed）"
        @click="rightTab = 'diagnostics'"
      >
        诊断 {{ errorCount }}/{{ warningCount }}
      </button>
      <button class="preview-button" @click="previewing = true">▶ 预览</button>
      <button @click="onNew">新建</button>
      <label class="file-button">
        导入
        <input
          type="file"
          accept=".json,application/json"
          @change="onImportFile"
        />
      </label>
      <button @click="onExport">导出</button>
      <!-- 目录 input 兜底取径（无 FSA 的浏览器 / 自动化测试）：恒在 DOM，触发点由脚本决定 -->
      <input
        ref="fallbackInput"
        class="fallback-input"
        type="file"
        webkitdirectory
        multiple
        @change="onFallbackFiles"
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
        <button
          v-for="path in documentPaths"
          :key="path"
          role="tab"
          class="doc-tab"
          :class="{ active: path === workspace.activePath }"
          :aria-selected="path === workspace.activePath"
          :title="path"
          @click="selectDocument(path)"
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
        </button>
      </div>

      <div class="workspace-body">
        <!-- 活动栏：切侧栏模式（资源 / 搜索 / 最近） -->
        <ActivityBar
          :mode="layout.sidebar"
          :counts="sidebarCounts"
          @update:mode="setSidebarMode"
        />

        <!-- 侧栏：可拖宽 / 可折叠。「列 · 组件」作为内页保留（故事编辑器专属工具） -->
        <aside
          v-show="!layout.leftCollapsed"
          class="pane columns-pane"
          :style="{ width: `${layout.leftWidth}px` }"
        >
          <div class="tab-strip left-tabs">
            <button
              v-for="tab in LEFT_TABS"
              :key="tab.id"
              :class="{ active: leftTab === tab.id }"
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
            <ResourceTreeView
              :nodes="resourceNodes"
              :active-path="workspace.activePath"
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
          <div v-show="leftTab === 'columns'" class="left-pane-body">
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
          <PropertyPanel :story="story" :pointer="selectedPointer" />
        </template>
        <StageEditor
          v-else-if="centerView === 'stage'"
          :story="story"
          :pointer="selectedPointer"
          :resource-port="resourcePort"
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
        <div class="tab-strip">
          <button
            :class="{ active: rightTab === 'diagnostics' }"
            @click="rightTab = 'diagnostics'"
          >
            诊断
          </button>
          <button
            :class="{ active: rightTab === 'json' }"
            @click="rightTab = 'json'"
          >
            JSON
          </button>
          <button
            :class="{ active: rightTab === 'text' }"
            @click="rightTab = 'text'"
          >
            文本
          </button>
        </div>
        <DiagnosticsPanel
          v-show="rightTab === 'diagnostics'"
          :diagnostics="diagnostics"
        />
        <JsonView v-show="rightTab === 'json'" :story="story" />
        <TextModeView v-show="rightTab === 'text'" :story="story" />
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
    />

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
  border-radius: 5px;
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
  border-radius: 4px;
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--lf-surface-overlay);
  border-bottom: 1px solid var(--lf-border-subtle);
  /* 窄窗不横向溢出：整体可换行（D-62④）。
     ⚠️ 修法不是"关掉溢出"——那会把右侧按钮截掉（用户看不见 = 不可用）；
     而是「允许换行 + 换行后仍各自完整」。配合 button 的 `white-space: nowrap`，
     按钮**整体**换行，不会被拆成两半。 */
  flex-wrap: wrap;
  row-gap: 6px;
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
  border-radius: 5px;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  white-space: nowrap;
  border: 1px solid var(--lf-border-strong);
  border-bottom: none;
  border-radius: 5px 5px 0 0;
  background: var(--lf-surface-raised);
  color: var(--lf-text-secondary);
}
.doc-tab.active {
  background: var(--lf-surface-active);
  color: var(--lf-text-primary);
  border-color: var(--lf-text-hint);
}
.doc-tab-name {
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: var(--lf-font-md);
}
.pane {
  background: var(--lf-surface-raised);
  border: 1px solid var(--lf-border-subtle);
  border-radius: 8px;
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
