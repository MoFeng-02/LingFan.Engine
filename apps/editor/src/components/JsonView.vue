<script setup lang="ts">
import { computed } from "vue";
import type { Story } from "@lingfan/engine";

const props = defineProps<{ story: Story }>();
const json = computed(() => JSON.stringify(props.story, null, 2));
</script>

<template>
  <div class="json-view">
    <!-- 只读镜像：编辑一律走视图操作（D1 纯映射器保证树与视图一致）；结构化 JSON 编辑视图随后续增量 -->
    <pre>{{ json }}</pre>
  </div>
</template>

<style scoped>
.json-view {
  flex: 1;
  overflow: auto;
}
pre {
  margin: 0;
  font-family: Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #9aa5ce;
  white-space: pre-wrap;
}
</style>
