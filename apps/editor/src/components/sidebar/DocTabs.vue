<script setup lang="ts">
import { columnIdOfDocument } from "../../domain";

/** 标签页（多文档）：一个资源 = 一个标签 = 一个独立会话（脏标记各自独立） */
defineProps<{
  documentPaths: string[];
  documentDirty: Set<string>;
  activeDocumentPath: string | undefined;
}>();

const emit = defineEmits<{
  (e: "select", path: string): void;
  (e: "close", path: string): void;
  (e: "add-flow-column"): void;
}>();
</script>

<template>
  <div class="tab-strip doc-tabs" role="tablist" aria-label="已打开的资源">
    <!-- 外层是 div[role=tab] 而非 button：内含关闭按钮（button嵌 button 无效 HTML）；
         键盘通路 = tabindex + Enter（role=tab 的最小可用形态）。 -->
    <div
      v-for="path in documentPaths"
      :key="path"
      role="tab"
      class="doc-tab"
      :class="{ active: path === activeDocumentPath }"
      :aria-selected="path === activeDocumentPath"
      :title="path"
      :tabindex="path === activeDocumentPath ? 0 : -1"
      @click="emit('select', path)"
      @keydown.enter.prevent="emit('select', path)"
      @auxclick.middle.prevent="emit('close', path)"
    >
      <span class="doc-tab-name">{{
        columnIdOfDocument(path) ?? path.split("/").pop() ?? path
      }}</span>
      <span
        v-if="documentDirty.has(path)"
        class="dirty-dot"
        title="有未保存的更改"
        aria-label="有未保存的更改"
      ></span>
      <button
        class="doc-tab-close"
        title="关闭标签（中键同）"
        :aria-label="`关闭 ${columnIdOfDocument(path) ?? path}`"
        @click.stop="emit('close', path)"
      >
        ✕
      </button>
    </div>
    <!-- 文档标签补全：新建入口。
         绑的是 **新增流程列**（文档级，与 tab 同级），
            **不是** `onNew`（那是「新建整个工程」，会把工程重置为示例）。 -->
    <button
      class="doc-tab-add"
      title="新增流程列"
      aria-label="新增流程列"
      @click="emit('add-flow-column')"
    >
      +
    </button>
  </div>
</template>
