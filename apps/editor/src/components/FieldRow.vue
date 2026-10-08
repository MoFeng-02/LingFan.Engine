<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { EDITOR_API_KEY } from "../contracts";
import {
  coerceFieldValue,
  describeNodeLabel,
  listOps,
  type FieldDescriptor,
} from "@lingfan/editor";

/**
 * 属性面板字段行：由表单描述符驱动渲染（kind → 控件），
 * 嵌套（数组项对象/命令体）递归自身；全部写入经 editorApi → EditorSession。
 */
const props = defineProps<{
  /** 指向该字段值的 JSON Pointer */
  pointer: string;
  field: FieldDescriptor;
  value: unknown;
}>();

const api = inject(EDITOR_API_KEY)!;

const jsonError = ref("");
const bodyOp = ref("say");

const opOptions = listOps().map((m) => ({ op: m.op, label: m.label }));

/**
 * 标量文本族：`value` 也走文本输入（智能字面量由 `coerceFieldValue` 还原）——
 * 漏掉 `value` 会让 set/define 的值、元素 x/width 等字段**没有任何控件**。
 */
const isScalarText = computed(() =>
  ["string", "identifier", "resource", "expression", "text", "value"].includes(
    props.field.kind,
  ),
);

const coerce = (raw: string): unknown =>
  coerceFieldValue(props.field.kind, raw);

/**
 * 标量文本控件的显示值：字符串原样；**数字/布尔转字面量**——
 * 否则既有数字值（如 `set value: 10`）在输入框里显示为空，看着像丢字段。
 */
const scalarText = computed(() => {
  const value = props.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
});

function onTextChange(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === "") {
    api.removeField(props.pointer); // 置空 = 删除字段（必填缺失 → 诊断标红）
    return;
  }
  api.update(props.pointer, coerce(raw));
}

function onBooleanChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value;
  if (raw === "") {
    api.removeField(props.pointer);
    return;
  }
  api.update(props.pointer, raw === "true");
}

function onTupleChange(itemIndex: number, event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  const current = Array.isArray(props.value) ? [...props.value] : [0, 0];
  current[itemIndex] = Number(raw);
  api.update(props.pointer, current);
}

function onJsonChange(event: Event): void {
  const raw = (event.target as HTMLTextAreaElement).value;
  try {
    const parsed = JSON.parse(raw) as unknown;
    jsonError.value = "";
    api.update(props.pointer, parsed);
  } catch (e) {
    jsonError.value = `JSON 解析失败：${String(e)}`;
  }
}

const jsonDraft = computed(() => JSON.stringify(props.value ?? null, null, 2));

/* —— 数组项对象（menu.options / if.elif / switch.cases / minigame.reward）—— */
const itemProperties = computed(() => props.field.item?.properties ?? []);
const items = computed(() => (Array.isArray(props.value) ? props.value : []));
const isItemObjectArray = computed(
  () => props.field.kind === "array" && itemProperties.value.length > 0,
);
function itemPointer(itemIndex: number, key: string): string {
  return `${props.pointer}/${itemIndex}/${key}`;
}
function itemValue(itemIndex: number, key: string): unknown {
  const item = items.value[itemIndex];
  if (item === null || typeof item !== "object") return undefined;
  return (item as Record<string, unknown>)[key];
}
function addItem(): void {
  const item: Record<string, unknown> = {};
  for (const property of itemProperties.value) {
    if (property.required) item[property.key] = "";
  }
  api.update(props.pointer, [...items.value, item]);
}
function removeItem(itemIndex: number): void {
  api.update(
    props.pointer,
    items.value.filter((_, i) => i !== itemIndex),
  );
}

/* —— 命令体（if.then / while.body / switch.default / func.body）—— */
const isBody = computed(() => props.field.kind === "body");
interface BodyRow {
  pointer: string;
  label: string;
  summary: string;
  cmd: Record<string, unknown>;
}
const bodyRows = computed<BodyRow[]>(() => {
  if (!isBody.value || !Array.isArray(props.value)) return [];
  return props.value.map((cmd, i): BodyRow => {
      const record = cmd as Record<string, unknown>;
      return {
        pointer: `${props.pointer}/${i}`,
        label: describeNodeLabel(record), // 与时间线同源（命令按 op、元素按类型）
        summary: bodySummary(record),
        cmd: record,
      };
    });
});
function bodySummary(cmd: Record<string, unknown>): string {
  const text = cmd.text ?? cmd.prompt ?? cmd.target ?? cmd.key ?? cmd.game;
  return typeof text === "string" && text !== "" ? text : "";
}
function insertBodyCommand(): void {
  api.insertCommand(props.pointer, { op: bodyOp.value });
}
function moveBody(pointer: string, delta: number): void {
  api.moveCommand(pointer, delta);
}
</script>

<template>
  <div class="field-row" :class="{ body: isBody }">
    <label
      class="field-label"
      :title="`${field.label}（${field.kind}${field.required ? '，必填' : ''}）`"
    >
      {{ field.label }}<span v-if="field.required" class="req">*</span>
    </label>

    <!-- 标量文本族 -->
    <textarea
      v-if="field.kind === 'text'"
      class="control grow"
      rows="2"
      :value="typeof value === 'string' ? value : ''"
      :placeholder="field.kind === 'text' ? '支持 {var} 插值与行内标记' : ''"
      @change="onTextChange"
    ></textarea>
    <input
      v-else-if="isScalarText"
      class="control grow"
      type="text"
      :value="scalarText"
      :placeholder="
        field.kind === 'expression'
          ? '{表达式}'
          : field.kind === 'resource'
            ? 'Audio/xxx.mp3'
            : field.kind === 'identifier'
              ? '标识符'
              : ''
      "
      @change="onTextChange"
    />

    <!-- 数值 -->
    <input
      v-else-if="field.kind === 'number' || field.kind === 'integer'"
      class="control"
      type="number"
      :step="field.kind === 'integer' ? 1 : 'any'"
      :value="typeof value === 'number' ? value : ''"
      @change="onTextChange"
    />

    <!-- 布尔 -->
    <select
      v-else-if="field.kind === 'boolean'"
      class="control"
      :value="typeof value === 'boolean' ? String(value) : ''"
      @change="onBooleanChange"
    >
      <option value="">{{ field.required ? "（必选）" : "（未设置）" }}</option>
      <option value="true">true</option>
      <option value="false">false</option>
    </select>

    <!-- 枚举 -->
    <select
      v-else-if="field.kind === 'enum'"
      class="control"
      :value="typeof value === 'string' ? value : ''"
      @change="onTextChange"
    >
      <option value="">（未设置）</option>
      <option v-for="e in field.enumValues" :key="e" :value="e">{{ e }}</option>
    </select>

    <!-- 元组（如 random.range [min, max]） -->
    <span v-else-if="field.kind === 'tuple'" class="tuple">
      <input
        class="control"
        type="number"
        :value="Array.isArray(value) ? (value[0] as number) : ''"
        @change="onTupleChange(0, $event)"
      />
      <span class="tuple-sep">…</span>
      <input
        class="control"
        type="number"
        :value="Array.isArray(value) ? (value[1] as number) : ''"
        @change="onTupleChange(1, $event)"
      />
    </span>

    <!-- 数组项对象（卡片递归） -->
    <div v-else-if="isItemObjectArray" class="item-list">
      <div v-for="(_, i) in items" :key="i" class="item-card">
        <div class="item-head">
          <span>项 {{ i }}</span>
          <button class="mini danger" aria-label="删除该项" @click="removeItem(i)">✕</button>
        </div>
        <FieldRow
          v-for="sub in itemProperties"
          :key="sub.key"
          :pointer="itemPointer(i, sub.key)"
          :field="sub"
          :value="itemValue(i, sub.key)"
        />
      </div>
      <button class="add-item" @click="addItem">+ 加一项</button>
    </div>

    <!-- 标量数组 / 对象（JSON 编辑） -->
    <div
      v-else-if="field.kind === 'array' || field.kind === 'object'"
      class="json-wrap"
    >
      <textarea
        class="control json"
        rows="3"
        :value="jsonDraft"
        spellcheck="false"
        @change="onJsonChange"
      ></textarea>
      <span v-if="jsonError !== ''" class="json-error">{{ jsonError }}</span>
    </div>

    <!-- 命令体：嵌套命令列表（点击进入编辑，面包屑返回） -->
    <div v-else-if="isBody" class="body-list">
      <div
        v-for="(row, i) in bodyRows"
        :key="row.pointer"
        class="body-row"
        @click="api.select(row.pointer)"
      >
        <span class="index">{{ i }}</span>
        <span class="op-label">{{ row.label }}</span>
        <span class="summary">{{ row.summary }}</span>
        <span class="row-ops" @click.stop>
          <button
            class="mini"
            aria-label="上移该命令"
            :disabled="i === 0"
            @click="moveBody(row.pointer, -1)"
          >
            ↑
          </button>
          <button
            class="mini"
            aria-label="下移该命令"
            :disabled="i === bodyRows.length - 1"
            @click="moveBody(row.pointer, 1)"
          >
            ↓
          </button>
          <button
            class="mini danger"
            aria-label="删除该命令"
            @click="api.removeCommand(row.pointer)"
          >
            ✕
          </button>
        </span>
      </div>
      <div class="body-insert" @click.stop>
        <select v-model="bodyOp" class="control">
          <option v-for="op in opOptions" :key="op.op" :value="op.op">
            {{ op.label }}
          </option>
        </select>
        <button class="mini" @click="insertBodyCommand">+ 插入</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: "FieldRow" };
</script>

<style scoped>
.field-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
}
.field-row.body {
  flex-direction: column;
  align-items: stretch;
  border: 1px dashed var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  padding: 6px 8px;
  margin: 4px 0;
}
.field-label {
  min-width: 92px;
  color: var(--lf-text-secondary);
  font-size: var(--lf-font-md);
  padding-top: 4px;
  flex-shrink: 0;
}
.req {
  color: var(--lf-danger);
}
.control {
  /* 右缘统一：若 `.control` 设 `max-width:260px` 而 `.control.grow`
     写 `max-width:none` ⇒ 同一面板内出现**多种右缘**，控件参差成锯齿。
     改为**一律撑满**（标签列固定宽，控件列吃满剩余空间）。 */
  flex: 1;
  min-width: 0;
  max-width: none;
}
.control.grow {
  flex: 1;
  max-width: none;
}
textarea.control {
  font-family: inherit;
  resize: vertical;
}
.tuple {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.tuple-sep {
  color: var(--lf-text-hint);
}
.item-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-card {
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-md);
  padding: 6px 8px;
}
.item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
  margin-bottom: 2px;
}
button.add-item {
  align-self: flex-start;
}
.json-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
textarea.json {
  font-family: Consolas, monospace;
  font-size: var(--lf-font-sm);
  max-width: none;
}
.json-error {
  color: var(--lf-danger);
  font-size: var(--lf-font-sm);
}
.body-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.body-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--lf-radius-md);
  cursor: pointer;
  background: var(--lf-surface-overlay);
  border: 1px solid transparent;
}
.body-row:hover {
  border-color: color-mix(in srgb, var(--lf-accent) 33%, transparent);
}
.index {
  color: var(--lf-text-hint);
  min-width: 16px;
  text-align: right;
}
.op-label {
  color: var(--lf-accent);
  min-width: 64px;
}
.summary {
  flex: 1;
  color: var(--lf-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-ops {
  /* 常显低强调：hover-only 的行内操作在触屏与新用户面前等于不存在。
     改常显但压低视觉权重，hover 时才提升 —— 可见性不靠鼠标。 */
  display: inline-flex;
  gap: 2px;
  opacity: 0.45;
  transition: opacity 120ms ease;
}
.body-row:hover .row-ops {
  opacity: 1;
}
.body-insert {
  display: flex;
  gap: 6px;
  margin-top: 4px;
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
</style>
