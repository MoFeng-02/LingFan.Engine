<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import type { Story, StoryColumn } from "@lingfan/engine";
import { layoutColumns, type ColumnGroupingView } from "@lingfan/editor";
import { decideAddColumn } from "../addColumnIntent";
import { useDialog } from "../dialogInjection";

/**
 * 列侧栏 + 列分组归类（UI 侧元数据）。
 * 分组**只做分区与折叠**，展示序恒按 `story.columns`（列序 = 文件路径码元序 = 叙事语义）
 * 重排——分组永不改变列序、不进故事 JSON、不产生 undo。
 */
const props = defineProps<{ story: Story; selectedId: string }>();

interface EditorApi {
  select(pointer: string | null): void;
  selectColumn(id: string): void;
  addColumn(kind: "flow" | "scene", hint?: string): void;
  renameColumn(from: string, to: string): void;
  removeColumn(id: string): void;
}
const api = inject<EditorApi>("editorApi")!;
/** 应用内对话框（替代原生 prompt/confirm/alert —— D-62①） */
const dialog = useDialog();

/** 分组视图 API（与 `editorApi` 分离：视图偏好不走会话提交） */
interface ColumnGroupingApi {
  view: Ref<ColumnGroupingView>;
  addGroup(name: string): void;
  renameGroup(groupId: string, name: string): void;
  removeGroup(groupId: string): void;
  assignColumn(columnId: string, groupId: string | null): void;
  toggleCollapsed(groupId: string): void;
}
const grouping = inject<ColumnGroupingApi>("columnGroupingApi")!;

/** 拖拽 MIME（自定义类型 + text/plain 兜底）与「未归类」区的落点键 */
const DRAG_TYPE = "application/x-lingfan-column";
const UNGROUPED_KEY = "__ungrouped__";

interface ColumnSection {
  key: string;
  name: string;
  collapsed: boolean;
  columns: string[];
  /** 是否渲染组头（平铺态 = 单段无头，视图与今天完全一致） */
  header: boolean;
}

const columns = computed(() => props.story.columns);
const columnIds = computed(() => columns.value.map((column) => column.id));
const byId = computed(
  () => new Map(columns.value.map((column) => [column.id, column])),
);
const layout = computed(() =>
  layoutColumns(grouping.view.value, columnIds.value),
);
/** 有分组才切到分组视图；无分组 = 平铺（不用分组的作者零视觉变化） */
const grouped = computed(() => layout.value.groups.length > 0);

const sections = computed<ColumnSection[]>(() => {
  if (!grouped.value) {
    return [
      {
        key: UNGROUPED_KEY,
        name: "",
        collapsed: false,
        columns: columnIds.value,
        header: false,
      },
    ];
  }
  return [
    ...layout.value.groups.map((group) => ({
      key: group.id,
      name: group.name,
      collapsed: group.collapsed,
      columns: group.columns,
      header: true,
    })),
    {
      key: UNGROUPED_KEY,
      name: "未归类",
      collapsed: false,
      columns: layout.value.ungrouped,
      header: true,
    },
  ];
});

const draggingId = ref<string | null>(null);
const dropKey = ref<string | null>(null);

function rowsOf(ids: readonly string[]): StoryColumn[] {
  const rows: StoryColumn[] = [];
  for (const id of ids) {
    const column = byId.value.get(id);
    if (column !== undefined) rows.push(column);
  }
  return rows;
}

function selectColumn(id: string): void {
  api.select(null); // 清命令选中（跨列选择不保留）
  api.selectColumn(id);
}

async function promptRename(id: string): Promise<void> {
  const next = await dialog.askText({
    title: `重命名列「${id}」`,
    message: "引用会同步更新。",
    initial: id,
    allowEmpty: false,
  });
  // 取消（null）/ 留空（allowEmpty:false 已归为取消）/ 未改名 ⇒ 都不执行
  if (next === null || next === id) return;
  api.renameColumn(id, next);
}

async function confirmRemove(id: string): Promise<void> {
  if (id === props.story.entry) {
    await dialog.notify({
      title: "入口列不可删除",
      message: "可先改 story.entry 指向别的列，再删除此列。",
      tone: "warning",
    });
    return;
  }
  const ok = await dialog.askConfirm({
    title: `删除列「${id}」？`,
    message: "指向它的跳转将报 missing-target 诊断。",
    danger: true,
  });
  if (ok) api.removeColumn(id);
}

async function promptAddGroup(): Promise<void> {
  const name = await dialog.askText({ title: "新建分组", initial: "" });
  if (name === null) return; // 取消 = 不建（留空 = 建「默认名」，语义不同）
  grouping.addGroup(name);
}

/** +列先要一个语义化 id 建议（**取消 = 不执行**；留空 = 引擎兜底生成 column-N；重名由 suggestColumnId 唯一化） */
async function promptAddColumn(kind: "flow" | "scene"): Promise<void> {
  const raw = await dialog.askText({
    title: `新${kind === "flow" ? "流程" : "场景"}列`,
    message: "语义化短 id（如 tavern）更利于按 id 定位；留空将自动生成 column-N。",
    initial: "",
    allowEmpty: true,
  });
  const intent = decideAddColumn(raw); // 取消/留空的判据仍在纯函数里（D-58）
  if (!intent.run) return;
  api.addColumn(kind, intent.hint);
}

async function promptRenameGroup(section: ColumnSection): Promise<void> {
  const next = await dialog.askText({
    title: `重命名分组「${section.name}」`,
    initial: section.name,
    allowEmpty: false,
  });
  if (next === null || next === section.name) return;
  grouping.renameGroup(section.key, next);
}

async function confirmRemoveGroup(section: ColumnSection): Promise<void> {
  const hint =
    section.columns.length > 0
      ? `组内 ${section.columns.length} 列将回到「未归类」（列本身不删除）。`
      : "";
  const ok = await dialog.askConfirm({
    title: `删除分组「${section.name}」？`,
    message: hint,
    danger: true,
  });
  if (ok) grouping.removeGroup(section.key);
}

function onDragStart(event: DragEvent, columnId: string): void {
  if (!grouped.value) return; // 平铺态无落点可拖
  draggingId.value = columnId;
  const dt = event.dataTransfer;
  if (dt === null) return;
  dt.setData(DRAG_TYPE, columnId);
  dt.setData("text/plain", columnId);
  dt.effectAllowed = "move";
}

function onDragEnd(): void {
  draggingId.value = null;
  dropKey.value = null;
}

function onDragOver(event: DragEvent, sectionKey: string): void {
  if (draggingId.value === null) return; // 只接内部列拖拽
  event.preventDefault(); // 允许 drop
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
  dropKey.value = sectionKey;
}

function onDragLeave(sectionKey: string): void {
  if (dropKey.value === sectionKey) dropKey.value = null;
}

function onDrop(event: DragEvent, sectionKey: string): void {
  dropKey.value = null;
  const dragged = draggingId.value;
  draggingId.value = null;
  const dt = event.dataTransfer;
  const columnId =
    dt?.getData(DRAG_TYPE) || dt?.getData("text/plain") || dragged || "";
  // 未知/陈旧列 id 一律忽略；未知分组 id 由纯函数 fail-closed（原样返回）
  if (columnId === "" || !byId.value.has(columnId)) return;
  grouping.assignColumn(
    columnId,
    sectionKey === UNGROUPED_KEY ? null : sectionKey,
  );
}
</script>

<template>
  <div class="grouped" :class="{ flat: !grouped }">
    <p v-if="grouped" class="grouping-hint">
      分组仅存本机、不改列序（列序 = 文件路径码元序）：拖列到分组即归类，拖回「未归类」即取出。
    </p>
    <section
      v-for="section in sections"
      :key="section.key"
      class="column-section"
      :class="{
        group: section.header,
        ungrouped: section.header && section.key === UNGROUPED_KEY,
        'drop-active': grouped && dropKey === section.key,
      }"
      @dragover="onDragOver($event, section.key)"
      @dragleave="onDragLeave(section.key)"
      @drop.prevent="onDrop($event, section.key)"
    >
      <header v-if="section.header" class="group-head">
        <button
          class="mini caret"
          :title="section.collapsed ? '展开分组' : '折叠分组'"
          :aria-expanded="!section.collapsed"
          @click="grouping.toggleCollapsed(section.key)"
        >
          {{ section.collapsed ? "▸" : "▾" }}
        </button>
        <span class="gname">{{ section.name }}</span>
        <span class="gcount">{{ section.columns.length }}</span>
        <span class="ops">
          <button
            class="mini"
            title="重命名分组"
            @click.stop="promptRenameGroup(section)"
          >
            ✎
          </button>
          <button
            class="mini danger"
            title="删除分组（列回到未归类）"
            @click.stop="confirmRemoveGroup(section)"
          >
            ✕
          </button>
        </span>
      </header>
      <ul v-show="!section.collapsed" class="column-list">
        <li
          v-for="column in rowsOf(section.columns)"
          :key="column.id"
          :class="{ selected: column.id === selectedId }"
          :draggable="grouped"
          @click="selectColumn(column.id)"
          @dragstart="onDragStart($event, column.id)"
          @dragend="onDragEnd"
        >
          <span class="kind" :class="column.kind">{{
            column.kind === "flow" ? "流" : "景"
          }}</span>
          <span class="cid">{{ column.id }}</span>
          <span v-if="column.id === story.entry" class="entry-badge" title="入口列"
            >入口</span
          >
          <span class="ops">
            <button
              class="mini"
              title="重命名（引用同步）"
              @click.stop="promptRename(column.id)"
            >
              ✎
            </button>
            <button
              class="mini danger"
              title="删除列"
              @click.stop="confirmRemove(column.id)"
            >
              ✕
            </button>
          </span>
        </li>
      </ul>
    </section>
  </div>
  <div class="add-row">
    <button @click="promptAddColumn('flow')">+ 流程列</button>
    <button @click="promptAddColumn('scene')">+ 场景列</button>
    <button title="新建列分组（仅存本机）" @click="promptAddGroup">+ 分组</button>
  </div>
</template>

<style scoped>
.grouped {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.grouping-hint {
  margin: 0;
  font-size: var(--lf-font-xs);
  line-height: 1.4;
  color: var(--lf-text-hint);
}
.column-section.group {
  border: 1px solid var(--lf-border-quiet);
  border-radius: var(--lf-radius-md);
  padding: 4px 4px 6px;
}
.column-section.group.ungrouped {
  border-style: dashed;
}
.column-section.drop-active {
  border-color: var(--lf-accent);
  background: var(--lf-surface-hover);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
}
.group-head .gname {
  flex: 1;
  font-size: var(--lf-font-md);
  color: var(--lf-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-head .gcount {
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
.group-head:hover .ops {
  display: inline-flex;
}
button.caret {
  padding: 0 4px;
}

.column-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.column-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--lf-radius-md);
  cursor: pointer;
}
.column-list li:hover {
  background: var(--lf-surface-hover);
}
.column-list li.selected {
  background: var(--lf-border-subtle);
}
.kind {
  font-size: var(--lf-font-xs);
  padding: 1px 4px;
  border-radius: var(--lf-radius-sm);
  color: var(--lf-surface-base);
}
.kind.flow {
  background: var(--lf-accent);
}
.kind.scene {
  background: var(--lf-success);
}
.cid {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-badge {
  font-size: var(--lf-font-xs);
  color: var(--lf-warning);
  border: 1px solid color-mix(in srgb, var(--lf-warning) 40%, transparent);
  border-radius: var(--lf-radius-sm);
  padding: 0 4px;
}
.ops {
  /* 常显低强调（E2 建议值）：hover-only 的行内操作在触屏与新用户面前等于不存在
     （D-62②）。改常显但压低视觉权重，hover 时才提升 —— 可见性不靠鼠标。 */
  display: inline-flex;
  gap: 2px;
  opacity: 0.45;
  transition: opacity 120ms ease;
}
.column-list li:hover .ops {
  opacity: 1;
}
button.mini {
  padding: 0 5px;
  font-size: var(--lf-font-sm);
  line-height: 18px;
}
button.danger:hover {
  color: var(--lf-danger);
  border-color: color-mix(in srgb, var(--lf-danger) 53%, transparent);
}
.add-row {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.add-row button {
  flex: 1;
}
</style>
