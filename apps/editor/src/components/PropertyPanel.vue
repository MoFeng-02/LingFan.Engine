<script setup lang="ts">
import { computed, inject } from "vue";
import type { Story } from "@lingfan/engine";
import {
  describeForm,
  describeSelection,
  elementLabel,
  getAtPointer,
} from "@lingfan/editor";
import { EDITOR_API_KEY } from "../contracts";
import FieldRow from "./FieldRow.vue";

const props = defineProps<{ story: Story; pointer: string | null }>();

const api = inject(EDITOR_API_KEY)!;

/**
 * 选中态**四态**：`none` / `non-command` / `unknown-op` / `command`。
 * 判定收在 `@lingfan/editor` 的纯函数里（可测），本组件只按 `kind` 选文案。
 */
const selection = computed(() =>
  describeSelection(props.story, props.pointer),
);

const cmd = computed(() =>
  props.pointer === null
    ? undefined
    : (getAtPointer(props.story, props.pointer) as
        | Record<string, unknown>
        | undefined),
);

/** 仅 `command` / `unknown-op` 是「落在命令上」（面包屑与表单区只对这两态有意义） */
const onCommand = computed(
  () =>
    selection.value.kind === "command" ||
    selection.value.kind === "unknown-op",
);

const opName = computed(() =>
  onCommand.value ? String((cmd.value as Record<string, unknown>).op) : "",
);

/** 仅 `command` 有表单描述符；`unknown-op` 恒为 `undefined`（那正是它的定义） */
const descriptor = computed(() =>
  selection.value.kind === "command" ? describeForm(opName.value) : undefined,
);

/**
 * `none` / `non-command` 的**中性陈述**。
 *
 * **约束：这里不得出现「缺失 / 错误 / 诊断」字样** —— 选中列 / 元素 / 数组项
 * 都是**正常操作**，若把正常操作说成故障、还指向一个**同时显示「✓ 无诊断」**的面板，
 * 两处会互相打脸。
 * 只有 `unknown-op`（落在命令上但无表单）才是真问题，文案见模板。
 */
const neutralText = computed(() => {
  if (selection.value.kind === "none") {
    return "在时间线中选择一条命令开始编辑。";
  }
  const node = cmd.value;
  switch (selection.value.nodeKind) {
    case "column": {
      const kind = node?.kind === "scene" ? "场景列" : "流程列";
      // 原文案「点它里面的某条命令即可编辑」**没说"里面"在哪** ——
      //    中央区可能是一片空白（列不是命令，属性面板自然没内容），作者不知道该去哪。
      //    补上**去处**。
      // 只说去处，**不提**「诊断」等字样：`selection-description.test.ts` 有一条
      //    防回流守卫 —— 正常态文案（`none`/`non-command`）禁用「缺失 / 错误 / 诊断」，
      //    因为旧文案曾把**正常操作**说成故障、还指向一个同时显示「✓ 无诊断」的面板。
      //    那条守卫的边界是**有意设计**，不该为一句引导放宽。
      const where = node?.kind === "scene" ? "「舞台」" : "「时间线」";
      return `当前选中的是${kind}——列本身不是命令。到${where}里点一条命令即可编辑。`;
    }
    case "element": {
      const type =
        typeof node?.type === "string" ? elementLabel(node.type) : "未知类型";
      return `当前选中的是元素「${type}」——元素属性在「舞台」视图里编辑，本视图只编辑命令。`;
    }
    case "item":
      return "当前选中的是组内的一项——请选中它所在的那条命令。";
    default:
      return "当前选中的位置不是命令——请在时间线上选择一条命令。";
  }
});

/** 面包屑：指针前缀中的命令祖先（嵌套块体逐级返回） */
const ancestors = computed(() => {
  if (props.pointer === null) return [];
  const segments = props.pointer.split("/");
  const out: { pointer: string; label: string }[] = [];
  for (let i = 2; i <= segments.length; i += 1) {
    const prefix = segments.slice(0, i).join("/");
    const node = getAtPointer(props.story, prefix) as
      Record<string, unknown> | undefined;
    if (
      node !== undefined &&
      typeof node === "object" &&
      typeof node.op === "string"
    ) {
      out.push({
        pointer: prefix,
        label: describeForm(node.op)?.label ?? node.op,
      });
    }
  }
  return out;
});
</script>

<template>
  <div class="property-panel">
    <h2>属性面板</h2>

    <p
      v-if="selection.kind === 'none' || selection.kind === 'non-command'"
      class="hint"
    >
      {{ neutralText }}
    </p>

    <template v-else>
      <div class="crumbs">
        <button
          v-if="ancestors.length > 1"
          class="mini"
          @click="api.select(null)"
        >
          顶
        </button>
        <template v-for="(crumb, i) in ancestors" :key="crumb.pointer">
          <span v-if="i > 0 || ancestors.length > 1" class="sep">›</span>
          <button
            class="crumb"
            :class="{ current: i === ancestors.length - 1 }"
            :disabled="i === ancestors.length - 1"
            @click="api.select(crumb.pointer)"
          >
            {{ crumb.label }}
          </button>
        </template>
      </div>

      <p v-if="selection.kind === 'unknown-op'" class="hint">
        未知或未实现的 op：<code>{{ opName }}</code
        >（诊断面板标红；可删除该命令）
      </p>

      <div v-else class="fields">
        <FieldRow
          v-for="field in descriptor?.fields ?? []"
          :key="field.key"
          :pointer="`${pointer}/${field.key}`"
          :field="field"
          :value="cmd![field.key]"
        />
        <p v-if="descriptor !== undefined && descriptor.fields.length === 0" class="hint">
          该命令无负载字段。
        </p>
      </div>

      <p v-if="selection.kind === 'command'" class="op-meta">
        {{ descriptor?.label ?? "" }} · {{ opName }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.property-panel {
  border-top: 1px solid var(--lf-border-subtle);
  padding-top: 8px;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
button.crumb {
  background: transparent;
  border-color: var(--lf-border-strong);
}
button.crumb.current {
  color: var(--lf-accent);
  border-color: color-mix(in srgb, var(--lf-accent) 40%, transparent);
  cursor: default;
}
.sep {
  color: var(--lf-text-hint);
}
.fields {
  display: flex;
  flex-direction: column;
}
.hint {
  color: var(--lf-text-hint);
  font-style: italic;
}
.op-meta {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
  margin: 8px 0 0;
  text-align: right;
}
button.mini {
  padding: 0 6px;
  font-size: var(--lf-font-sm);
  line-height: 18px;
}
</style>
