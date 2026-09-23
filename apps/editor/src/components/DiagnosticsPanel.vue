<script setup lang="ts">
import { inject } from "vue";
import type { Diagnostic } from "@lingfan/editor";

defineProps<{ diagnostics: Diagnostic[] }>();

interface EditorApi {
  select(pointer: string | null): void;
}
const api = inject<EditorApi>("editorApi")!;

/** D6：诊断带 JSON Pointer——点击定位到命令（空指针 = 全局诊断，不可定位） */
function locate(diagnostic: Diagnostic): void {
  if (diagnostic.pointer !== "") api.select(diagnostic.pointer);
}
const keyOf = (d: Diagnostic): string => `${d.code}@${d.pointer}:${d.message}`;
</script>

<template>
  <div class="diag-panel">
    <p v-if="diagnostics.length === 0" class="clean">
      ✓ 无诊断（编辑期校验通过）
    </p>
    <ul v-else class="diag-list">
      <li
        v-for="diagnostic in diagnostics"
        :key="keyOf(diagnostic)"
        :class="diagnostic.severity"
        @click="locate(diagnostic)"
      >
        <span class="dot"></span>
        <span class="code">{{ diagnostic.code }}</span>
        <span class="message">{{ diagnostic.message }}</span>
        <code v-if="diagnostic.pointer !== ''" class="pointer">{{
          diagnostic.pointer
        }}</code>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.diag-panel {
  flex: 1;
  overflow: auto;
}
.clean {
  color: #9ece6a;
  padding: 8px;
}
.diag-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.diag-list li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.diag-list li:hover {
  background: #1a1b26;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}
li.error .dot {
  background: #f7768e;
}
li.warning .dot {
  background: #e0af68;
}
.code {
  font-family: Consolas, monospace;
  font-size: 11px;
  color: #565f89;
  flex-shrink: 0;
}
.message {
  flex: 1;
}
.pointer {
  color: #7aa2f7;
  font-size: 10px;
  opacity: 0.7;
}
</style>
