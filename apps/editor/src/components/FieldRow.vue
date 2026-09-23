<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { describeForm, listOps, type FieldDescriptor } from "@lingfan/editor";

/**
 * 06-D2 属性面板字段行：由表单描述符驱动渲染（kind → 控件），
 * 嵌套（数组项对象/命令体）递归自身；全部写入经 editorApi → EditorSession。
 */
const props = defineProps<{
  /** 指向该字段值的 JSON Pointer */
  pointer: string;
  field: FieldDescriptor;
  value: unknown;
}>();

interface EditorApi {
  update(pointer: string, value: unknown): void;
  removeField(pointer: string): void;
  select(pointer: string | null): void;
  insertCommand(pointer: string, command: Record<string, unknown>): void;
  removeCommand(pointer: string): void;
  moveCommand(pointer: string, delta: number): void;
}
const api = inject<EditorApi>("editorApi")!;

const jsonError = ref("");
const bodyOp = ref("say");

const opOptions = listOps().map((m) => ({ op: m.op, label: m.label }));

const isScalarText = computed(() =>
  ["string", "identifier", "resource", "expression", "text"].includes(
    props.field.kind,
  ),
);

function coerce(raw: string): unknown {
  switch (props.field.kind) {
    case "number":
    case "integer":
      return Number(raw);
    case "boolean":
      return raw === "true";
    case "value":
      if (raw === "true") return true;
      if (raw === "false") return false;
      if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
      return raw;
    default:
      return raw;
  }
}

function onTextChange(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === "") {
    api.removeField(props.pointer); // 置空 = 删除字段（必填缺失 → 诊断标红，D3）
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
    const op = (cmd as Record<string, unknown>)?.op;
    return {
      pointer: `${props.pointer}/${i}`,
      label:
        typeof op === "string" ? (describeForm(op)?.label ?? op) : "（坏命令）",
      summary: bodySummary(cmd as Record<string, unknown>),
      cmd: cmd as Record<string, unknown>,
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
      :value="typeof value === 'string' ? value : ''"
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
          <button class="mini danger" @click="removeItem(i)">✕</button>
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
            :disabled="i === 0"
            @click="moveBody(row.pointer, -1)"
          >
            ↑
          </button>
          <button
            class="mini"
            :disabled="i === bodyRows.length - 1"
            @click="moveBody(row.pointer, 1)"
          >
            ↓
          </button>
          <button class="mini danger" @click="api.removeCommand(row.pointer)">
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
  border: 1px dashed #3b4261;
  border-radius: 6px;
  padding: 6px 8px;
  margin: 4px 0;
}
.field-label {
  min-width: 92px;
  color: #9aa5ce;
  font-size: 12px;
  padding-top: 4px;
  flex-shrink: 0;
}
.req {
  color: #f7768e;
}
.control {
  max-width: 260px;
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
  color: #565f89;
}
.item-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item-card {
  border: 1px solid #3b4261;
  border-radius: 6px;
  padding: 6px 8px;
}
.item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #565f89;
  font-size: 11px;
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
  font-size: 11px;
  max-width: none;
}
.json-error {
  color: #f7768e;
  font-size: 11px;
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
  border-radius: 5px;
  cursor: pointer;
  background: #16161e;
  border: 1px solid transparent;
}
.body-row:hover {
  border-color: #7aa2f755;
}
.index {
  color: #565f89;
  min-width: 16px;
  text-align: right;
}
.op-label {
  color: #7aa2f7;
  min-width: 64px;
}
.summary {
  flex: 1;
  color: #9aa5ce;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-ops {
  display: none;
  gap: 2px;
}
.body-row:hover .row-ops {
  display: inline-flex;
}
.body-insert {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}
button.mini {
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
}
button.danger:hover {
  color: #f7768e;
  border-color: #f7768e88;
}
</style>
