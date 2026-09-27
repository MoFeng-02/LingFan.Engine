<script setup lang="ts">
import { computed, provide, ref, useTemplateRef } from "vue";
import type {
  AudioPort,
  LayerZTable,
  ProjectWriteReport,
  ResourcePort,
  Story,
  VideoPort,
} from "@lingfan/engine";
import { DEFAULT_LAYER_Z } from "@lingfan/engine";
import {
  EditorSession,
  addColumn,
  analyzeStory,
  getAtPointer,
  insertAtPointer,
  moveAtPointer,
  removeAtPointer,
  removeColumn,
  renameColumn,
  setAtPointer,
} from "@lingfan/editor";
import { sampleStory } from "./sample";
import ColumnList from "./components/ColumnList.vue";
import StoryTimeline from "./components/StoryTimeline.vue";
import StageEditor from "./components/StageEditor.vue";
import PropertyPanel from "./components/PropertyPanel.vue";
import DiagnosticsPanel from "./components/DiagnosticsPanel.vue";
import JsonView from "./components/JsonView.vue";
import TextModeView from "./components/TextModeView.vue";
import NodeGraph from "./components/NodeGraph.vue";
import PreviewHost from "./components/PreviewHost.vue";
import type { OpenedProject, ProjectOpener } from "./ports";

/**
 * 组合根注入（本组件不碰任何平台 API / 适配器）：
 * - `initialStory` = 未打开工程时的示例故事；
 * - `opener` = 「打开工程」取径（目录选择与文件读取都在 main.ts）；
 * - 媒体端口工厂 = 视频层 z 等实现细节留在组合根。
 */
const props = defineProps<{
  /** 启动时的故事（未打开工程 = 内存示例；「打开工程」后由会话中枢换基线） */
  initialStory: Story;
  opener: ProjectOpener;
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}>();

/** 06 §一.1：EditorSession = 视图族共享中枢（一处改动全视图同步 + 统一 undo） */
let session = new EditorSession(props.initialStory);
const story = ref<Story>(session.story);
const undoDepth = ref(0);
const redoDepth = ref(0);
const selectedColumnId = ref<string>(session.story.entry);
const selectedPointer = ref<string | null>(null);
const rightTab = ref<"diagnostics" | "json" | "text">("diagnostics");
const centerView = ref<"timeline" | "stage" | "graph">("timeline");
const previewing = ref(false);
/** 已打开工程：资源供给端口（未打开 = undefined → 预览不解析资源，维持示例语义） */
const resourcePort = ref<ResourcePort | undefined>(undefined);
/** 已打开工程的资源根名（界面显示；空 = 示例故事） */
const projectRoot = ref("");
/** 08 §八.3 层级表：打开工程 = 清单 `shell.layers` 覆盖；未打开 = 内建默认（预览解析实例级 z 用） */
const layerZ = ref<LayerZTable>(DEFAULT_LAYER_Z);
const openError = ref("");
/** 保存回磁盘（09-16）：`undefined` = 未打开工程或只读取径 → 保存禁用 */
const saveFn = ref<((s: Story) => Promise<ProjectWriteReport>) | undefined>(
  undefined,
);
/** 不可保存时的可操作提示（按钮 title） */
const saveHint = ref("");
const saving = ref(false);
const dirty = ref(false);
const saveError = ref("");
const saveNotice = ref("");
const fallbackInput = useTemplateRef<HTMLInputElement>("fallbackInput");

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
  projectRoot.value = opened.root;
  saveFn.value = opened.save;
  saveHint.value = opened.saveHint ?? "";
  saveError.value = "";
  saveNotice.value = "";
}

/**
 * 解绑磁盘工程（09-16 裁定）：「新建 / 导入」是内存态故事，若保持绑定，
 * 一次误点保存会把示例/导入内容覆盖真实工程——故一律解绑。
 * 提示用**状态口径**（「未绑定」而非「你刚点了新建」）：绑定状态不随 undo 回滚，
 * 若文案携带历史，撤销「新建」后就会留下过期说明。
 */
function unbindProject(): void {
  saveFn.value = undefined;
  saveHint.value = UNBOUND_HINT;
  projectRoot.value = "";
  resourcePort.value = undefined;
  layerZ.value = DEFAULT_LAYER_Z; // 解绑后回内建层级表
  saveError.value = "";
  saveNotice.value = "";
}

function onNew(): void {
  api.replaceAll(sampleStory(), "新建");
  unbindProject();
}

const diagnostics = computed(() => analyzeStory(story.value));
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
  /** 向数组容器插入命令（pointer 指向数组；缺省追加末尾） */
  insertCommand(pointer: string, command: Record<string, unknown>): void {
    session.apply(`插入 ${command.op}`, (s) => {
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
    selectedPointer.value = pointer;
    const columnPointer = pointer?.match(/^\/columns\/(\d+)/);
    if (columnPointer !== null && columnPointer !== undefined) {
      const column = getAtPointer(story.value, columnPointer[0]) as
        { id?: string } | undefined;
      if (typeof column?.id === "string") selectedColumnId.value = column.id;
    }
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
    session.apply(`重命名 ${from} → ${to}`, (s) => renameColumn(s, from, to));
  },
  addColumn(kind: "flow" | "scene"): void {
    session.apply(`新增${kind === "flow" ? "流程" : "场景"}列`, (s) => {
      const result = addColumn(s, { kind });
      selectedColumnId.value = result.id;
      return result.story;
    });
  },
  removeColumn(id: string): void {
    session.apply(`删除列 ${id}`, (s) => removeColumn(s, id));
  },
  replaceAll(next: Story, label: string): void {
    session.commit(label, next);
    selectedPointer.value = null;
    selectedColumnId.value = next.entry;
  },
};
provide("editorApi", api);
provide("selectedPointer", selectedPointer);

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
 */
async function onSave(): Promise<void> {
  const run = saveFn.value;
  if (run === undefined || saving.value) return;
  const target = story.value;
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

    <main class="workspace">
      <aside class="pane columns-pane">
        <h2>列</h2>
        <ColumnList :story="story" :selected-id="selectedColumnId" />
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
        <NodeGraph v-else :story="story" :selected-id="selectedColumnId" />
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
</style>
