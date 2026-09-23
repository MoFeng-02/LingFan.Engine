<script setup lang="ts">
import { computed, inject } from "vue";
import type { Story } from "@lingfan/engine";
import { describeForm, getAtPointer } from "@lingfan/editor";
import FieldRow from "./FieldRow.vue";

const props = defineProps<{ story: Story; pointer: string | null }>();

interface EditorApi {
  select(pointer: string | null): void;
}
const api = inject<EditorApi>("editorApi")!;

const cmd = computed(() =>
  props.pointer === null
    ? undefined
    : (getAtPointer(props.story, props.pointer) as
        Record<string, unknown> | undefined),
);
const isCommand = computed(
  () =>
    cmd.value !== undefined &&
    typeof cmd.value === "object" &&
    typeof cmd.value.op === "string",
);
const descriptor = computed(() =>
  isCommand.value ? describeForm(opName.value) : undefined,
);
const opName = computed(() =>
  isCommand.value ? String((cmd.value as Record<string, unknown>).op) : "",
);

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

    <p v-if="pointer === null" class="hint">在时间线中选择一条命令开始编辑。</p>
    <p v-else-if="!isCommand" class="hint">
      所选位置不是命令（op 缺失）——诊断面板有详情。
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

      <p v-if="descriptor === undefined" class="hint">
        未知或未实现的 op：<code>{{ opName }}</code
        >（诊断面板标红；可删除该命令）
      </p>

      <div v-else class="fields">
        <FieldRow
          v-for="field in descriptor.fields"
          :key="field.key"
          :pointer="`${pointer}/${field.key}`"
          :field="field"
          :value="cmd![field.key]"
        />
        <p v-if="descriptor.fields.length === 0" class="hint">
          该命令无负载字段。
        </p>
      </div>

      <p class="op-meta">{{ descriptor?.label ?? "" }} · {{ opName }}</p>
    </template>
  </div>
</template>

<style scoped>
.property-panel {
  border-top: 1px solid #24283b;
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
  border-color: #3b4261;
}
button.crumb.current {
  color: #7aa2f7;
  border-color: #7aa2f766;
  cursor: default;
}
.sep {
  color: #565f89;
}
.fields {
  display: flex;
  flex-direction: column;
}
.hint {
  color: #565f89;
  font-style: italic;
}
.op-meta {
  color: #565f89;
  font-size: 11px;
  margin: 8px 0 0;
  text-align: right;
}
button.mini {
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
}
</style>
