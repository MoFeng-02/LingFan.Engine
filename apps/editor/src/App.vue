<script setup lang="ts">
import { computed, provide, ref } from "vue";
import type { Story } from "@lingfan/engine";
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
import PropertyPanel from "./components/PropertyPanel.vue";
import DiagnosticsPanel from "./components/DiagnosticsPanel.vue";
import JsonView from "./components/JsonView.vue";
import TextModeView from "./components/TextModeView.vue";
import NodeGraph from "./components/NodeGraph.vue";
import PreviewHost from "./components/PreviewHost.vue";

/** 06 §一.1：EditorSession = 视图族共享中枢（一处改动全视图同步 + 统一 undo） */
const session = new EditorSession(sampleStory());
const story = ref<Story>(session.story);
const undoDepth = ref(0);
const redoDepth = ref(0);
const selectedColumnId = ref<string>(session.story.entry);
const selectedPointer = ref<string | null>(null);
const rightTab = ref<"diagnostics" | "json" | "text">("diagnostics");
const centerView = ref<"timeline" | "graph">("timeline");
const previewing = ref(false);

session.subscribe((s) => {
  story.value = s;
  undoDepth.value = session.undoDepth;
  redoDepth.value = session.redoDepth;
});

const diagnostics = computed(() => analyzeStory(story.value));
const errorCount = computed(
  () => diagnostics.value.filter((d) => d.severity === "error").length,
);
const warningCount = computed(
  () => diagnostics.value.filter((d) => d.severity === "warning").length,
);

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
  selectColumn(id: string): void {
    selectedColumnId.value = id;
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
    } catch (e) {
      alert(`导入失败：${String(e)}`);
    }
  };
  reader.readAsText(file);
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
      <button @click="api.replaceAll(sampleStory(), '新建')">新建</button>
      <label class="file-button">
        导入
        <input
          type="file"
          accept=".json,application/json"
          @change="onImportFile"
        />
      </label>
      <button @click="onExport">导出</button>
    </header>

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

    <PreviewHost v-if="previewing" :story="story" @close="previewing = false" />
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
