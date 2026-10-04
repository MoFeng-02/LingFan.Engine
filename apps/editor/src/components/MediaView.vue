<script setup lang="ts">
/**
 * 媒体预览视图（`Images` / `Audio` / `Video`）：预览 + 元数据，**只读**。
 *
 * 取数走既有 `ResourcePort.resolve`（逻辑路径 → Blob URL）——媒体供给链已有，
 * 本组件不新造取数机制。URL 属宿主生命周期，卸载即释放（防 Blob 泄漏）。
 */
import { onBeforeUnmount, ref, watch } from "vue";
import type { ResourcePort } from "@lingfan/engine";

const props = defineProps<{
  path: string;
  /** 媒体种类（分派表只会把 image/audio/video 路由过来；`other` 走兜底） */
  kind: "image" | "audio" | "video" | "other";
  resourcePort: ResourcePort | undefined;
}>();

const url = ref<string | undefined>(undefined);
const error = ref("");

/** 上一份 Blob URL 释放后再设新的（否则切换资源会泄漏 URL） */
let owned: string | undefined;

async function load(): Promise<void> {
  error.value = "";
  if (props.resourcePort === undefined) {
    error.value = "未打开工程（无资源供给端口）";
    return;
  }
  try {
    const next = await props.resourcePort.resolve(props.path);
    if (owned !== undefined) props.resourcePort?.release(owned);
    owned = next;
    url.value = next;
  } catch (e) {
    url.value = undefined;
    error.value = `资源不可用：${e instanceof Error ? e.message : String(e)}`;
  }
}

watch(() => [props.path, props.resourcePort], load, { immediate: true });

onBeforeUnmount(() => {
  if (owned !== undefined) props.resourcePort?.release(owned);
  owned = undefined;
});
</script>

<template>
  <section class="media-view">
    <header class="view-head">
      <h2>资源预览</h2>
      <span class="path" :title="path">{{ path }}</span>
      <span class="badge">只读</span>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-else class="stage">
      <img v-if="kind === 'image' && url" :src="url" :alt="path" />
      <video v-else-if="kind === 'video' && url" :src="url" controls></video>
      <audio v-else-if="kind === 'audio' && url" :src="url" controls></audio>
      <p v-else class="empty">该资源类型暂无预览（可用「外部编辑器」打开）</p>
    </div>
  </section>
</template>

<style scoped>
.media-view {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  gap: 6px;
}
.view-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.view-head h2 {
  margin: 0;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
}
.path {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-family: Consolas, monospace;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50ch;
}
.badge {
  font-size: var(--lf-font-xs);
  padding: 0 5px;
  border-radius: 3px;
  background: var(--lf-border-subtle);
  color: var(--lf-text-hint);
}
.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lf-surface-sunken);
  border: 1px solid var(--lf-border-subtle);
  border-radius: 6px;
  padding: 12px;
  overflow: auto;
}
.stage img,
.stage video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.error {
  color: var(--lf-danger);
  font-size: var(--lf-font-md);
}
.empty {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-md);
  font-style: italic;
}
</style>
