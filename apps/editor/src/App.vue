<script setup lang="ts">
import { computed, provide, reactive, ref, useTemplateRef, watch } from "vue";
import type { Ref } from "vue";
import type { Story } from "@lingfan-engine/core";
import type { AudioPort, VideoPort } from "@lingfan-engine/core";
import {
  addGroup,
  analyzeStory,
  assignColumn,
  createColumnGroupingStore,
  emptyGroupingView,
  pruneGroupingView,
  removeGroup,
  renameGroup,
  toggleCollapsed,
  type ColumnGroupingView,
  type KeyValueStorage,
} from "@lingfan-engine/editor";
import { sampleStory } from "./shared";
import {
  buildResourceTree,
  columnIdOfDocument,
  createDialogPort,
  DialogHostState,
} from "./domain";
import { decideAddColumn, type EmptyAction } from "./domain";
import type { ResourceNode } from "./domain";
import { createLayoutStore, type LayoutState } from "./infra";
import {
  createEditorApi,
  useEditorSave,
  useHostBridge,
  useI18nWorkbench,
  useProjectFiles,
  useProjectOpen,
  useProjectPorts,
  useResourcePreview,
  useSearchCorpus,
  type LeftTab,
} from "./app";
import { DIALOG_PORT_KEY } from "./app";
import {
  COLUMN_GROUPING_API_KEY,
  COLUMN_PATHS_KEY,
  EDITOR_API_KEY,
  KEY_VALUE_STORAGE_KEY,
  SELECTED_POINTER_KEY,
  type LastProjectEntry,
  type OpenedProject,
  type ProjectOpener,
} from "./contracts";
import { PreviewHost } from "./components/stage";
import {
  DialogHost,
  ProjectBanners,
  StatusBar,
  TopToolbar,
} from "./components/shell";
import { DocTabs } from "./components/sidebar";
import {
  CenterStage,
  RightPane,
  SidebarPane,
  type RightTab,
} from "./components/panes";

/**
 * 组合根注入（本组件不碰任何平台 API / 适配器）：
 * - `initialStory` = 未打开工程时的示例故事；
 * - `opener` = 「打开工程」取径（目录选择与文件读取都在 main.ts）；
 * - `lastProject` = 「记住上次工程」：句柄就绪后由组合根填充（ref）；
 * - 媒体端口工厂 = 视频层 z 等实现细节留在组合根；
 * - `storage` / `downloadFile` = 本机偏好存储与导出下载，实现在 `infra`。
 */
const props = defineProps<{
  /** 启动时的故事（未打开工程 = 内存示例；「打开工程」后由会话中枢换基线） */
  initialStory: Story;
  opener: ProjectOpener;
  /** 上次工程一键重开入口（IDB 异步就绪后填充；无 = 按钮不渲染）。ref 随 props 显式传递 */
  lastProject?: Ref<LastProjectEntry | undefined>;
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
  /** 本机键值存储（组合根注入；站点数据被禁时为 `undefined` = 本会话无持久化） */
  storage: KeyValueStorage | undefined;
  /** 导出下载（平台细节在 `infra`，由组合根注入） */
  downloadFile: (fileName: string, text: string) => void;
}>();

/* —— 应用内对话框（替代原生 prompt/confirm/alert） —— */
const dialogState = new DialogHostState();
const dialog = createDialogPort(dialogState);
/** 栈变化 → 驱动 DialogHost 渲染（面板只读这个 ref） */
const dialogRequest = ref(dialogState.current);
dialogState.subscribe(() => {
  dialogRequest.value = dialogState.current;
});
provide(DIALOG_PORT_KEY, dialog);
/** 本机存储下发给需要自持久化的视图域（节点图布局等） */
provide(KEY_VALUE_STORAGE_KEY, props.storage);

/* ——— 工程绑定状态端口集（各视图域从这一份状态取数） ——— */
const ports = useProjectPorts();

/** 诊断基准 = 整工程树（跨列引用需全局视角；见下方 `diagnostics` 注） */
const projectTree = ref<Story | undefined>(undefined);

/* ——— 多文档中枢（一个资源 = 一个文档 = 一个会话） ——— */
const {
  workspace,
  story,
  undoDepth,
  redoDepth,
  dirty,
  selectedColumnId,
  selectedPointer,
  documentPaths,
  documentDirty,
  activeDocumentPath,
  getSession,
  bindActive,
  openColumnDocument,
  selectDocument,
  closeDocument,
  redistributeDocuments,
} = useProjectFiles({
  initialStory: props.initialStory,
  dialog,
  projectTree,
});

/* ——— 布局（可拖 + 可持久化） ——— */
const layoutStore = createLayoutStore(props.storage);
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

const leftTab = ref<LeftTab>("resources");
const rightTab = ref<RightTab>("property");
const centerView = ref<"timeline" | "stage" | "graph" | "step">("timeline");
/** 「揭示」序号（诊断面板/步骤图点选后自增）：时间线视图据此把选中行滚入视口 */
const revealTick = ref(0);

/**
 * 诊断供给侧：打开工程才注入（`resourceFiles` / `overlayKeys`）。
 * 未打开 = `undefined` ⇒ `analyzeStory` 收到空 options，两个检查器族整体跳过（不误报）。
 */
const diagnosticSupply = ref<OpenedProject["diagnosticSupply"] | undefined>(
  undefined,
);

/* ——— 资源树（工程维度，资源管理器的主体面） ——— */
/** 工程资源集（逻辑路径）——由诊断供给侧顺带供给，零新增 IO */
const resourcePaths = computed<readonly string[]>(() =>
  [...(diagnosticSupply.value?.resourceFiles ?? [])].sort(),
);
const resourceNodes = computed<readonly ResourceNode[]>(() =>
  buildResourceTree(resourcePaths.value),
);

/* ——— 内容搜索语料（按需加载并缓存） ——— */
const {
  searchKeyword,
  invalidateCorpus,
  searchReport,
  searchFilter,
  recentFilter,
} = useSearchCorpus({
  readTextFn: ports.readTextFn,
  resourcePaths,
  leftTab,
  workspace,
});

/* ——— 顶栏派生（工程标识 chip） ——— */
/** 工程名（chip 主文本）：优先取资源根目录名，其次 story.id */
const projectName = computed(() => {
  const root = ports.projectRoot.value;
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
  if (ports.projectRoot.value === "") return "尚未打开工程";
  const lines = [`工程资源根：${ports.projectRoot.value}`];
  if (ports.hostRoot.value !== "")
    lines.push(`宿主工作区根：${ports.hostRoot.value}`);
  return lines.join("\n");
});
/** 导入按钮的取径：走隐藏 input（自动化可触发） */
function pickImport(): void {
  importInput.value?.click();
}

/* ——— 模板引用（隐藏 input；「⋯」菜单锚点在 TopToolbar 组件内） ——— */
const fallbackInput = useTemplateRef<HTMLInputElement>("fallbackInput");
const importInput = useTemplateRef<HTMLInputElement>("importInput");

/**
 * 空态主动作（空态必须给出可点的下一步）。
 * 「打开工程」走真实取径；「用外部编辑器打开」**如实不可用**。
 */
function onEmptyAction(action: EmptyAction): void {
  if (action.id === "open-project") {
    void openProject();
    return;
  }
  // 无宿主 ⇒ 如实提示"不可用"（浏览器形态物理上无法启动进程）
  void dialog.notify({
    title: "当前形态无法用外部编辑器打开",
    message:
      "需要本地应用宿主（pnpm --filter @lingfan-engine/editor-app host）。请先用「打开工程」。",
    tone: "info",
  });
}

/**
 * 诊断集：打开工程后注入供给侧数据（资源缺失 / 未使用译文键两个检查器才生效，
 * 见诊断供给侧）；未打开工程 = 空 options（跳过相关诊断族，不误报）。
 *
 * 诊断吃的是**整工程树**（`projectTree`），不是活动标签的单列切片：
 * 跨列引用（如 `jump`/`menu` 指向另一列的列 id）在切片视角下会被判成
 * 「missing-target 目标不存在」——而目标其实就在另一个标签里。
 * 诊断是**工程级**关注点，不随标签切片。
 */
const diagnostics = computed(() => {
  const tree = projectTree.value ?? story.value;
  const supply = diagnosticSupply.value;
  return supply === undefined
    ? analyzeStory(tree)
    : analyzeStory(tree, {
        // 只喂 `analyzeStory` 契约认的字段 —— 供给侧还有 `overlayKeysByLang`
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

/* ——— 保存域（整工程 / 单文档 / 规范化确认 / 导出） ——— */
const {
  saving,
  saveError,
  saveNotice,
  normalizationNotice,
  skipNormalizationNotice,
  canSave,
  saveTooltip,
  onSave,
  confirmNormalization,
  cancelNormalization,
  onSkipNormalizationChange,
  onExport,
} = useEditorSave({
  story,
  session: getSession,
  workspace,
  documentDirty,
  dirty,
  errorCount,
  ports,
  storage: () => props.storage,
  downloadFile: props.downloadFile,
});
/** 保存三态（写入侧统一出口：预览/骨架/打开域从这一份状态取数） */
const saveStatus = {
  saving,
  saveError,
  saveNotice,
  cancelNormalization,
};
/** 「不再提示」勾选（组件回抛更新值）：先落 ref 再立即写偏好 */
function onSkipNoticeInput(value: boolean): void {
  skipNormalizationNotice.value = value;
  onSkipNormalizationChange();
}

/* ——— 资源预览域（非故事资源的中心区面） ——— */
const {
  openResource,
  activeResource,
  activeSource,
  readError,
  activePath,
  activeSpec,
  activeMediaKind,
  activeReadOnlyReason,
  saveTextResource,
} = useResourcePreview({
  story,
  projectTree,
  workspace,
  selectedColumnId,
  selectDocument,
  dialog,
  ports,
  saveStatus,
});

/* ——— 工程打开域（FSA / 文件 input / 一键重开 / 解绑） ——— */
const {
  openProject,
  reopenLastProject,
  openFromFiles,
  applyOpened,
  unbindProject,
  reloadFromDisk,
} = useProjectOpen({
  opener: props.opener,
  lastProject: props.lastProject,
  requestFallbackPicker: () => fallbackInput.value?.click(),
  ports,
  diagnosticSupply,
  projectTree,
  workspace,
  openColumnDocument,
  bindActive,
  documentPaths,
  selectedPointer,
  selectedColumnId,
  invalidateCorpus,
  saveStatus,
  activeResource,
  activeSource,
});

/**
 * 目录 input 兜底取径的 DOM 侧：取文件快照 + 清空 input 值（允许重复选同一目录），
 * 再把快照交给打开域（打开域不碰元素）。
 */
function onFallbackInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  void openFromFiles(files);
}

/* ——— 本地化工作台（聚合面；数据全部来自既有诊断供给） ——— */
const { i18nSources, i18nLangs, generateLangSkeleton } = useI18nWorkbench({
  story,
  projectTree,
  diagnosticSupply,
  ports,
  saveStatus,
  dialog,
  applyOpened,
  lastProject: props.lastProject,
});

/* ——— 宿主桥（能力探测 + 热重载 + 打包转发） ——— */
const hostHint = ref(false);
const { localHostAvailable, packing, sendPackRequest, togglePackPane } =
  useHostBridge({
    ports,
    hostHint,
    dialog,
    rightTab,
    reloadFromDisk,
    dirtyCount: () => workspace.dirtyCount,
  });

/**
 * 列分组归类：**UI 侧元数据**——按 `story.id` 存本机、不入故事 JSON。
 * 列序 = 文件路径码元序属**叙事语义**，用存储层目录分组会隐式改写它；归类只是作者视图偏好。
 * 降级与节点图布局同款：读失败 → 平铺；写失败 → 仅本次会话有效。
 */
const groupingStore = createColumnGroupingStore(props.storage);
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

/**
 * **列 id → 来源文件路径**（章节树的路径面）。
 *
 * **为什么不能拿「已打开的文档」推导**：
 * `Workspace` 有**容量上限 `capacity = 50`**，打开更多列的工程会挤掉其余列；
 * 而 `workspace.documents` 只含**还开着的那些** ⇒ 被挤掉的列**在章节树里没有路径**
 * ⇒ label 为空（如 entry 列——它最早打开、最先被挤掉）。
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
 * 高亮对 `.story` 工程**永不命中**。
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

/** 编辑 API：provide 给全部视图（FieldRow/时间线/列侧栏共用一套会话提交） */
const api = createEditorApi({
  session: getSession,
  story,
  selectedPointer,
  selectedColumnId,
  projectTree,
  centerView,
  revealTick,
  grouping,
  workspace,
  openColumnDocument,
  selectDocument,
  redistributeDocuments,
  commitGrouping,
  syncGroupingColumns,
});

provide(EDITOR_API_KEY, api);
/**
 * 章节树的**路径面**（列 id → 来源文件路径）。
 *
 * 章节树据此把「列」按**作者的目录编排**分组（`Stories/chapter1/chapter1.story`
 * ⇒ 章节 `chapter1`）。生产者是文档集合（`workspace`），与标签栏**同源**
 * ⇒ 不额外维护第二份路径真相。
 */
provide(COLUMN_PATHS_KEY, columnPaths);
provide(SELECTED_POINTER_KEY, selectedPointer);

/**
 * 列分组 API（与 `editorApi` 分离）：**不经 session 提交**——视图偏好不产生 undo
 * 单元、不置 dirty、不进故事 JSON（列序属叙事语义，分组只是作者视图偏好）。
 */
provide(COLUMN_GROUPING_API_KEY, {
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

/**
 * 文档标签区的「+」：**新增一个流程（flow）列** = 新增一个文档。
 *
 * 与 `onNew` 的区别：`onNew` 是「**新建整个工程**」（重置为示例故事），
 *   那是工程级动作，放在「⋯」菜单里；这里是**文档级**动作，与 tab 同级。
 */
async function addFlowColumn(): Promise<void> {
  const result = await dialog.askText({
    title: "新增流程列",
    message:
      "列 id 建议用语义化短标识（如 tavern / morning）；留空则自动生成 column-N。",
    initial: "",
    allowEmpty: true,
  });
  if (result === null) return; // 取消 = 不新建（取消 ≠ 留空）
  const intent = decideAddColumn(result);
  if (!intent.run) return;
  api.addColumn("flow", intent.hint);
}

function onNew(): void {
  api.replaceAll(sampleStory(), "新建");
  unbindProject();
}

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
</script>

<template>
  <div class="editor-root">
    <TopToolbar
      v-model:center-view="centerView"
      :project-root="ports.projectRoot.value"
      :project-name="projectName"
      :story-id="story.id"
      :project-chip-title="projectChipTitle"
      :last-project="props.lastProject"
      :can-save="canSave"
      :save-tooltip="saveTooltip"
      :saving="saving"
      :undo-depth="undoDepth"
      :redo-depth="redoDepth"
      @open-project="openProject"
      @reopen-last="reopenLastProject"
      @preview="ports.previewing.value = true"
      @save="onSave"
      @undo="getSession().undo()"
      @redo="getSession().redo()"
      @import-json="pickImport"
      @export="onExport"
      @new="onNew"
    />

    <!-- 目录 input 兜底取径（无 FSA 的浏览器 / 自动化测试）：恒在 DOM，触发点由脚本决定 -->
    <input
      ref="fallbackInput"
      class="fallback-input"
      type="file"
      webkitdirectory
      multiple
      @change="onFallbackInput"
    />
    <input
      ref="importInput"
      class="fallback-input"
      type="file"
      accept=".json,application/json"
      @change="onImportFile"
    />

    <ProjectBanners
      :open-error="ports.openError.value"
      :save-error="saveError"
      :save-notice="saveNotice"
      :normalization-notice="normalizationNotice"
      :saving="saving"
      :skip-normalization-notice="skipNormalizationNotice"
      @dismiss-open-error="ports.openError.value = ''"
      @dismiss-save-error="saveError = ''"
      @dismiss-save-notice="saveNotice = ''"
      @confirm-normalization="confirmNormalization"
      @cancel-normalization="cancelNormalization"
      @update:skip-normalization-notice="onSkipNoticeInput"
    />

    <main class="workspace">
      <DocTabs
        :document-paths="documentPaths"
        :document-dirty="documentDirty"
        :active-document-path="activeDocumentPath"
        @select="selectDocument"
        @close="closeDocument"
        @add-flow-column="addFlowColumn"
      />

      <div class="workspace-body">
        <!--
          侧栏：左栏 tab 是唯一入口（5 项：资源/搜索/最近/列/组件），
          每项功能只此一个入口，不设重复入口的窄条。
        -->

        <SidebarPane
          v-model:left-tab="leftTab"
          v-model:search-keyword="searchKeyword"
          :left-collapsed="layout.leftCollapsed"
          :left-width="layout.leftWidth"
          :resource-nodes="resourceNodes"
          :resource-focus-path="resourceFocusPath"
          :project-id="story.id"
          :whole-story="projectTree ?? story"
          :selected-column-id="selectedColumnId"
          :active-document-path="workspace.activePath"
          :search-report="searchReport"
          :search-filter="searchFilter"
          :recent-filter="recentFilter"
          @open-resource="openResource"
          @resize="setLeftWidth"
        />

        <CenterStage
          :project-root="ports.projectRoot.value"
          :active-resource-open="activeResource !== undefined"
          :open-document-count="documentPaths.length"
          :dirty="dirty"
          :active-spec="activeSpec"
          :active-source="activeSource"
          :active-path="activePath"
          :active-media-kind="activeMediaKind"
          :active-read-only-reason="activeReadOnlyReason"
          :read-error="readError"
          :center-view="centerView"
          :reveal-tick="revealTick"
          :story="story"
          :selected-column-id="selectedColumnId"
          :selected-pointer="selectedPointer"
          :resource-port="ports.resourcePort.value"
          :first-scene-column-id="firstSceneColumnId"
          :save-text-resource="saveTextResource"
          @empty-action="onEmptyAction"
        />

        <RightPane
          v-model:right-tab="rightTab"
          :right-collapsed="layout.rightCollapsed"
          :right-width="layout.rightWidth"
          :story="story"
          :pointer="selectedPointer"
          :diagnostics="diagnostics"
          :i18n-sources="i18nSources"
          :i18n-langs="i18nLangs"
          :local-host-available="localHostAvailable"
          :packing="packing"
          :send="sendPackRequest"
          @open-resource="openResource"
          @generate="generateLangSkeleton"
          @toggle-pack="togglePackPane"
          @resize="setRightWidth"
        />
      </div>
    </main>

    <StatusBar
      v-if="layout.statusBar"
      :root="ports.projectRoot.value"
      :local-host="localHostAvailable"
      :document-count="workspace.documents.length"
      :dirty-count="workspace.dirtyCount"
      :error-count="errorCount"
      :warning-count="warningCount"
      :packing="packing"
      :pack-active="rightTab === 'pack'"
      :degraded="ports.degradedOpen.value"
      @toggle-pack="togglePackPane"
    />

    <!-- 「宿主未启动」非阻塞横幅：`pointer-events:none` ⇒ 绝不拦点击（模态遮罩会挡住所有点击） -->
    <div v-if="hostHint" class="host-hint" role="status">
      <span class="host-hint-text">
        未检测到本地宿主 —— 绝对路径 / 外部打开 / 一键打包 /
        热重载不可用（其余功能正常）。 启用：<code>pnpm editor:dev</code>
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
      @answer="
        (v) => dialogState.answer(v as string | boolean | null | undefined)
      "
      @dismiss="dialogRequest = dialogState.current"
    />

    <PreviewHost
      v-if="ports.previewing.value"
      :story="story"
      :resource-port="ports.resourcePort.value"
      :layer-z="ports.layerZ.value"
      :create-audio-port="createAudioPort"
      :create-video-port="createVideoPort"
      @close="ports.previewing.value = false"
    />
  </div>
</template>

<style src="./styles/app-shell.css"></style>
