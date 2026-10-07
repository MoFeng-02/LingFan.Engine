<script setup lang="ts">
/**
 * 对话框宿主：把 `DialogHostState` 的栈渲染成**应用内**弹窗（替代原生 prompt/confirm/alert）。
 *
 * a11y 必备（原生 box 全部白给，自建就得自己补）：`role="dialog"` + `aria-modal` +
 * `aria-labelledby` + **焦点陷阱**（Tab 在弹窗内循环）+ **Esc 关闭** + **打开时记住并恢复焦点**。
 *
 * 提交语义**统一走 `parseTextAnswer`**（`askText` 的取消/留空判据在纯函数里，
 * 组件与调用方都不自己判 `=== null`）——「取消被当成留空」那类数据丢失的根治点。
 */
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { parseTextAnswer, type DialogAnswer, type DialogRequest } from "../dialog";

const props = defineProps<{ request: DialogRequest | undefined }>();
const emit = defineEmits<{
  (e: "answer", value: DialogAnswer): void;
  (e: "dismiss"): void;
}>();

const panel = useTemplateRef<HTMLElement>("panel");
const text = ref("");
/** 打开前的活动元素（关闭后焦点回到它 —— 键盘用户的连续性） */
let restoreTo: HTMLElement | null = null;
let lastRequest: DialogRequest | undefined;

watch(
  () => props.request,
  async (next) => {
    if (next === undefined) {
      restoreTo?.focus?.();
      restoreTo = null;
      return;
    }
    if (next !== lastRequest) {
      // 新的请求：记住焦点 + 预填初值
      restoreTo = (document.activeElement as HTMLElement | null) ?? null;
      text.value = next.kind === "text" ? (next.initial ?? "") : "";
      lastRequest = next;
    }
    await nextTick();
    const focusTarget = panel.value?.querySelector<HTMLElement>("input, button");
    focusTarget?.focus();
    if (next.kind === "text") panel.value?.querySelector<HTMLInputElement>("input")?.select();
  },
  { immediate: true },
);

/** 焦点陷阱：Tab / Shift+Tab 在弹窗内循环 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    // Esc = 取消 ⇒ text 传 `null`（与原生语义一致，且不会把「取消」误当「留空」）
    emit("answer", props.request?.kind === "text" ? null : false);
    emit("dismiss");
    return;
  }
  if (event.key !== "Tab") return;
  const focusables = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [],
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function submit(): void {
  const request = props.request;
  if (request === undefined) return;
  if (request.kind === "text") {
    const parsed = parseTextAnswer(text.value, request.allowEmpty !== false);
    emit("answer", parsed.run ? parsed.value : null);
  } else if (request.kind === "confirm") {
    emit("answer", true);
  } else {
    emit("answer", undefined);
  }
  emit("dismiss");
}
</script>

<template>
  <div v-if="request" class="dialog-backdrop" @pointerdown.self="((emit('answer', request.kind === 'text' ? null : false), emit('dismiss')))">
    <div
      ref="panel"
      class="dialog-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      @keydown="onKeydown"
    >
      <h2 id="dialog-title" class="dialog-title">{{ request.title }}</h2>

      <p v-if="request.kind !== 'text' && request.message" class="dialog-message">
        {{ request.message }}
      </p>

      <input
        v-if="request.kind === 'text'"
        v-model="text"
        class="dialog-input"
        :placeholder="request.placeholder ?? ''"
        @keydown.enter.prevent="submit"
      />

      <!-- 选项选择：点选项即提交（无确定按钮）；Esc / 遮罩 / 取消按钮 = 取消。
           用按钮组（role=group）而非 listbox —— 「点选即提交」没有持久选中态，
           给每个 option 标 aria-selected=true 反而是错的。 -->
      <div v-if="request.kind === 'choice'" class="dialog-choices" role="group" aria-label="选项">
        <button
          v-for="option in request.options"
          :key="option.value"
          @click="((emit('answer', option.value), emit('dismiss')))"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="dialog-actions">
        <button
          v-if="request.kind !== 'notice'"
          @click="((emit('answer', request.kind === 'text' ? null : false), emit('dismiss')))"
        >
          取消
        </button>
        <button
          v-if="request.kind !== 'notice'"
          :class="{ danger: request.kind === 'confirm' && request.danger }"
          @click="submit"
        >
          {{ request.kind === "text" ? "确定" : "确定" }}
        </button>
        <button v-else @click="((emit('answer', undefined), emit('dismiss')))">知道了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 8, 12, 0.62);
  z-index: 50;
}
.dialog-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(420px, calc(100% - 32px));
  padding: 14px 16px;
  background: var(--lf-surface-overlay);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-lg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.dialog-title {
  margin: 0;
  font-size: var(--lf-font-lg);
  font-weight: 500;
  color: var(--lf-text-primary);
}
.dialog-message {
  margin: 0;
  font-size: var(--lf-font-md);
  line-height: 1.6;
  color: var(--lf-text-secondary);
  overflow-wrap: anywhere;
}
.dialog-input {
  width: 100%;
  font-size: var(--lf-font-md);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dialog-choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dialog-choices button {
  justify-content: flex-start;
  text-align: left;
  width: 100%;
}
button.danger {
  border-color: var(--lf-danger);
  color: var(--lf-danger);
}
button.danger:hover {
  background: var(--lf-danger-surface);
}
</style>
