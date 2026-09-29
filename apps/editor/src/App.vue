<script setup lang="ts">
import { computed, nextTick, provide, ref, shallowRef, useTemplateRef, watch } from "vue";
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
import PreviewHost from "./components/PreviewHost.vue";
import type {
  LastProjectEntry,
  OpenedProject,
  ProjectOpener,
} from "./ports";

/**
 * 组合根注入（本组件不碰任何平台 API / 适配器）：
 * - `initialStory` = 未打开工程时的示例故事；
 * - `opener` = 「打开工程」取径（目录选择与文件读取都在 main.ts）；
 * - `lastProject` = 「记住上次工程」（T03-06）：句柄就绪后由组合根填充（ref）；
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

/** 06 §一.1：EditorSession = 视图族共享中枢（一处改动全视图同步 + 统一 undo） */
let session = new EditorSession(props.initialStory);
/**
 * **shallowRef（D-47 修复）**：会话树靠「commit 恒换引用」运作，从不原地深改——
 * 深代理（`ref`）会让 `story.value` 变成 proxy ≠ `session.current` 原始引用，
 * `markSaved(story.value)` 后 `dirty = current !== saved` **恒真**（保存后「● 未保存」
 * 永不消失，真机 T03-03 旅程实测）。浅引用直存直取，与乐观并发语义精确对齐。
 */
const story = shallowRef<Story>(session.story);
const undoDepth = ref(0);
const redoDepth = ref(0);
const selectedColumnId = ref<string>(session.story.entry);
const selectedPointer = ref<string | null>(null);
const rightTab = ref<"diagnostics" | "json" | "text">("diagnostics");
const centerView = ref<"timeline" | "stage" | "graph">("timeline");
/** T04-02 组件面板：左栏 tab（「列」/「组件」）——200px 宽放不下两个长列表，切 tab 比堆叠可用 */
const leftTab = ref<"columns" | "palette">("columns");
const previewing = ref(false);
/** 已打开工程：资源供给端口（未打开 = undefined → 预览不解析资源，维持示例语义） */
const resourcePort = ref<ResourcePort | undefined>(undefined);
/** 已打开工程的资源根名（界面显示；空 = 示例故事） */
const projectRoot = ref("");
/** 08 §八.3 层级表：打开工程 = 清单 `shell.layers` 覆盖；未打开 = 内建默认（预览解析实例级 z 用） */
const layerZ = ref<LayerZTable>(DEFAULT_LAYER_Z);
/**
 * T02-01 / T02-02 诊断供给侧：打开工程才注入（`resourceFiles` / `overlayKeys`）。
 * 未打开 = `undefined` ⇒ `analyzeStory` 收到空 options，两个检查器族整体跳过（不误报）。
 */
const diagnosticSupply = ref<Required<AnalyzeOptions> | undefined>(undefined);
const openError = ref("");
/** 保存回磁盘（09-16）：`undefined` = 未打开工程或只读取径 → 保存禁用 */
const saveFn = ref<((s: Story) => Promise<ProjectWriteReport>) | undefined>(
  undefined,
);
/** T03-03 保存前规范化检测（与 save 同源装配；缺省 = 只读取径或无检测） */
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
 * T03-03 保存前规范化确认：检测有发现时暂存保存动作（确认后执行），界面展示
 * 「将被转换/移除的文件」清单。「不再提示」为本机视图偏好（D1：不入故事 JSON，
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
 * T04-01 列分组归类（裁定 R2 (a)）：**UI 侧元数据**——按 `story.id` 存本机、不入故事 JSON。
 * 列序 = 文件路径码元序属**叙事语义**，用存储层目录分组会隐式改写它；归类只是作者视图偏好（D1）。
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
 */
function attachSession(next: EditorSession): void {
  session = next;
  story.value = next.story;
  undoDepth.value = next.undoDepth;
  redoDepth.value = next.redoDepth;
  dirty.value = next.dirty;
  next.subscribe((s) => {
    story.value = s;
    undoDepth.value = next.undoDepth;
    redoDepth.value = next.redoDepth;
    dirty.value = next.dirty;
  });
}
attachSession(session);

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

/** 「记住上次工程」（T03-06）：一键重开（点击即手势，读权限按需申请） */
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
  attachSession(new EditorSession(opened.story));
  selectedPointer.value = null;
  selectedColumnId.value = opened.story.entry;
  resourcePort.value = opened.resourcePort;
  layerZ.value = opened.layerZ; // 08 §八.3：预览用工程层级表解析实例级 z
  diagnosticSupply.value = opened.diagnosticSupply; // T02-01/02：资源/译文检查器生效
  projectRoot.value = opened.root;
  saveFn.value = opened.save;
  inspectSaveFn.value = opened.inspectSave;
  saveHint.value = opened.saveHint ?? "";
  saveError.value = "";
  saveNotice.value = "";
  cancelNormalization(); // 换工程：上一次暂存的确认已过期（基线随会话换新）
}

/**
 * 解绑磁盘工程（09-16 裁定）：「新建 / 导入」是内存态故事，若保持绑定，
 * 一次误点保存会把示例/导入内容覆盖真实工程——故一律解绑。
 * 提示用**状态口径**（「未绑定」而非「你刚点了新建」）：绑定状态不随 undo 回滚，
 * 若文案携带历史，撤销「新建」后就会留下过期说明。
 */
function unbindProject(): void {
  saveFn.value = undefined;
  inspectSaveFn.value = undefined;
  saveHint.value = UNBOUND_HINT;
  projectRoot.value = "";
  resourcePort.value = undefined;
  layerZ.value = DEFAULT_LAYER_Z; // 解绑后回内建层级表
  diagnosticSupply.value = undefined; // 解绑后回「无供给侧」= 检查器族跳过
  saveError.value = "";
  saveNotice.value = "";
  cancelNormalization(); // 解绑 = 保存能力消失，暂存的确认一并作废
}

function onNew(): void {
  api.replaceAll(sampleStory(), "新建");
  unbindProject();
}

/**
 * 06 §一.2 诊断集：打开工程后注入供给侧数据（资源缺失 / 未使用译文键两个检查器才生效，
 * T02-01/02）；未打开工程 = 空 options（跳过相关诊断族，不误报）。
 */
const diagnostics = computed(() => {
  const supply = diagnosticSupply.value;
  return supply === undefined
    ? analyzeStory(story.value)
    : analyzeStory(story.value, {
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
  select(pointer: string | null): void {
    // D-48：诊断/引用的指针是字段级——归一到最近的命令祖先，行高亮与属性面板才有锚点
    selectedPointer.value =
      pointer === null ? null : nearestCommandPointer(story.value, pointer);
    const columnPointer = pointer?.match(/^\/columns\/(\d+)/);
    if (columnPointer !== null && columnPointer !== undefined) {
      const column = getAtPointer(story.value, columnPointer[0]) as
        { id?: string } | undefined;
      if (typeof column?.id === "string") selectedColumnId.value = column.id;
    }
    // D6 定位体验：点了诊断必须「看得见」——切回时间线视图并把目标行滚到视口中央
    //（此前只改选中态：长列表/其他视图下目标行在视口外 = 用户感知"点了没反应"）
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
    selectedColumnId.value = id;
    const index = story.value.columns.findIndex((c) => c.id === id);
    selectedPointer.value = index >= 0 ? `/columns/${index}` : null;
  },
  renameColumn(from: string, to: string): void {
    const changed = session.apply(`重命名 ${from} → ${to}`, (s) =>
      renameColumn(s, from, to),
    );
    // T04-01：分组是视图元数据，成员 id 随列改名同步（失败不影响故事编辑本身）
    if (changed) commitGrouping(renameColumnMember(grouping.value, from, to));
  },
  addColumn(kind: "flow" | "scene", hint?: string): void {
    session.apply(`新增${kind === "flow" ? "流程" : "场景"}列`, (s) => {
      const result = addColumn(s, { kind, hint });
      selectedColumnId.value = result.id;
      return result.story;
    });
  },
  removeColumn(id: string): void {
    // T04-01：列没了，分组里的悬空成员一并裁掉（否则会留下指向不存在列的归属）
    if (session.apply(`删除列 ${id}`, (s) => removeColumn(s, id))) {
      syncGroupingColumns();
    }
  },
  /**
   * T04-03 组件拖入：元素**落点创建**（`parentPointer` = 容器元素指针 → 进 `children`，
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
   * T04-04 节点图连线：从 `fromColumnId` 拉线到 `toColumnId` 建分支——
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
provide("editorApi", api);
provide("selectedPointer", selectedPointer);

/**
 * T04-01 列分组 API（与 `editorApi` 分离）：**不经 session 提交**——视图偏好不产生 undo
 * 单元、不置 dirty、不进故事 JSON（R2 (a)：列序属叙事语义，分组只是作者视图偏好）。
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
 * 保存回磁盘（09-16）：捕获**实际写出的那个引用**（乐观并发——await 期间用户又改，
 * 基线钉在 target 上仍 dirty，不误清）；成功后 `markSaved(target)`。
 * T03-03：保存前先做规范化检测（用户已「不再提示」则跳过检测）——有发现时**不执行**
 * 保存，展示清单等确认（跳过提示 ≠ 丢弃保存：确认/取消后状态干净）。
 */
async function onSave(): Promise<void> {
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

    <!-- T03-03 保存前规范化确认：清单 = describeNormalization（与真实写回行为一一对应） -->
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
      <aside class="pane columns-pane">
        <div class="tab-strip left-tabs">
          <button
            :class="{ active: leftTab === 'columns' }"
            @click="leftTab = 'columns'"
          >
            列
          </button>
          <button
            :class="{ active: leftTab === 'palette' }"
            @click="leftTab = 'palette'"
          >
            组件
          </button>
        </div>
        <!-- v-show 必须落在**单根元素**上：ColumnList 是多根模板，直接给它 v-show 会让指令失效
             （Vue: "Runtime directive used on component with non-element root node"）⇒ 命令面板不会隐藏 -->
        <div v-show="leftTab === 'columns'" class="left-pane-body">
          <ColumnList :story="story" :selected-id="selectedColumnId" />
        </div>
        <div v-show="leftTab === 'palette'" class="left-pane-body">
          <ComponentPalette />
        </div>
      </aside>

      <section class="pane center-pane">
        <template v-if="centerView === 'timeline'">
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
        <!-- D-45：key = story.id ⇒ 换工程/新建/导入必重挂载，布局缓存从新工程的存储键重读 -->
        <NodeGraph
          v-else
          :key="story.id"
          :story="story"
          :selected-id="selectedColumnId"
        />
      </section>

      <aside class="pane right-pane">
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
    </main>

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
  background: #101014;
  color: #c0caf5;
  font-size: 13px;
}
button {
  background: #24283b;
  color: #c0caf5;
  border: 1px solid #3b4261;
  border-radius: 5px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
input,
select,
textarea {
  background: #16161e;
  color: #c0caf5;
  border: 1px solid #3b4261;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 12px;
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
  background: #16161e;
  border-bottom: 1px solid #24283b;
}
.brand {
  color: #7aa2f7;
}
.story-id {
  color: #565f89;
}
.open-button {
  color: #7aa2f7;
  border-color: #7aa2f766;
}
.project-root {
  color: #565f89;
  font-size: 11px;
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
  color: #f7768e;
  border-bottom: 1px solid #f7768e44;
  background: #1a1218;
}
.save-notice {
  color: #9ece6a;
  border-bottom: 1px solid #9ece6a44;
  background: #121a14;
}
.save-normalization {
  border-bottom: 1px solid #e0af6844;
  background: #1a170f;
  color: #e0af68;
  padding: 8px 12px;
  font-size: 12px;
}
.save-normalization ul {
  margin: 6px 0;
  padding-left: 20px;
}
.save-normalization .normalization-note {
  margin: 4px 0;
  color: #565f89;
}
.save-normalization .normalization-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.save-button {
  color: #9ece6a;
  border-color: #9ece6a66;
}
.dirty-dot {
  color: #e0af68;
  font-size: 11px;
}
.undo-hint {
  color: #565f89;
  font-size: 11px;
}
.spacer {
  flex: 1;
}
.diag-badge.has-error {
  color: #f7768e;
  border-color: #f7768e88;
}
.view-switch button.active {
  color: #7aa2f7;
  border-color: #7aa2f7;
}
.preview-button {
  color: #9ece6a;
  border-color: #9ece6a66;
}
.file-button {
  background: #24283b;
  border: 1px solid #3b4261;
  border-radius: 5px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.file-button input {
  display: none;
}
.workspace {
  display: grid;
  grid-template-columns: 200px 1fr 320px;
  gap: 8px;
  padding: 8px;
  flex: 1;
  min-height: 0;
}
.pane {
  background: #13131a;
  border: 1px solid #24283b;
  border-radius: 8px;
  padding: 10px;
  overflow: auto;
  min-height: 0;
}
.columns-pane h2,
.pane h2 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #565f89;
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
}
.tab-strip {
  display: flex;
  gap: 4px;
}
.tab-strip button.active {
  border-color: #7aa2f7;
  color: #7aa2f7;
}
/* T04-02 左栏 tab（列 / 组件）：紧凑一行，下方内容各自滚动 */
.left-tabs {
  margin-bottom: 8px;
}
.left-tabs button {
  flex: 1;
}
</style>
