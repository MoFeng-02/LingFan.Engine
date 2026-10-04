<script setup lang="ts">
import { inject } from "vue";
import type { Diagnostic } from "@lingfan/editor";

defineProps<{ diagnostics: Diagnostic[] }>();

interface EditorApi {
  select(pointer: string | null): void;
  /** 定位揭示：选中 + 切回时间线 + 滚动到目标行（D-63 拆职责后新增） */
  reveal(pointer: string): void;
}
const api = inject<EditorApi>("editorApi")!;

/** 诊断带 JSON Pointer——点击定位到命令（空指针 = 全局诊断，不可定位） */
function locate(diagnostic: Diagnostic): void {
  // ⚠️ 必须用 `reveal`（不是 `select`）：点诊断必须「看得见」——
  // 目标行可能在视口外/其他视图下，单纯改选中态会被用户感知为"点了没反应"（D-63 拆职责后）。
  if (diagnostic.pointer !== "") api.reveal(diagnostic.pointer);
}
const keyOf = (d: Diagnostic): string => `${d.code}@${d.pointer}:${d.message}`;</script>

<template>
  <div class="diag-panel">
    <p v-if="diagnostics.length === 0" class="clean">
      ✓ 无诊断（编辑期校验通过）
    </p>
    <ul v-else class="diag-list">
      <li
        v-for="diagnostic in diagnostics"
        :key="keyOf(diagnostic)"
        :class="[diagnostic.severity, { global: diagnostic.pointer === '' }]"
        :title="
          diagnostic.pointer === ''
            ? '全局诊断：不指向具体命令，点击不可定位'
            : undefined
        "
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
  color: var(--lf-success);
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
  /* 指针/诊断码可能很长（深层逻辑路径）：允许换行到下一行，而不是把 .message 挤成 0 宽
     ——后者在 320px 窄栏里表现为**逐字竖排**（实测 .message 宽 20 / 高 782）。 */
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.diag-list li:hover {
  background: var(--lf-surface-hover);
}
/* 全局诊断（pointer 为空）：不可定位 → 不做可点击暗示 */
.diag-list li.global {
  cursor: default;
}
.diag-list li.global:hover {
  background: transparent;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}
li.error .dot {
  background: var(--lf-danger);
}
li.warning .dot {
  background: var(--lf-warning);
}
.code {
  font-family: Consolas, monospace;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  flex-shrink: 0;
}
.message {
  flex: 1;
  /* `flex: 1` 的隐含 `min-width: auto` 会让长中文/长路径把 flex 项撑到 min-content，
     在 320px 窄栏里表现为**逐字竖排**。必须显式 0 才允许收缩 + 换行。 */
  min-width: 0;
  overflow-wrap: anywhere;
}
/* 诊断码与指针是**定长标签**，不参与收缩：一旦它们可压缩，.message 会被挤到 0 宽
   ⇒ 正文逐字换行（实测 .message 宽 0 / 高 799）。 */
.code,
.pointer {
  flex-shrink: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
/* 指针独占一行（li 可换行后它自然落到第二行）；正文行至少占满整行宽度 */
.pointer {
  flex-basis: 100%;
  color: var(--lf-accent);
  font-size: var(--lf-font-xs);
  opacity: 0.7;
}
</style>
