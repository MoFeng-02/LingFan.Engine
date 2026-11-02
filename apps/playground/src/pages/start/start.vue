<script setup lang="ts">
/**
 * 启动页面：进游戏之前的普通界面，与引擎无关——它不订阅状态、不读引擎，
 * 只把「开始 / 继续 / 展开存档列表 / 选一个存档」几个意图回抛宿主，
 * 由宿主决定何时让引擎跑起来。
 *
 * 没有存档时「继续」与「读取存档」都不可点：按钮 disabled 并给出提示，
 * 避免玩家点了没反应。展开后列的是宿主递来的逐槽视图，空槽同样不可点——
 * 「从空槽继续」本来就无从做起，交给引擎只会换回一条读档失败。
 */
import type { SlotView } from "@lingfan-engine/shell";

withDefaults(
  defineProps<{
    /** 工程标题（组合根从 project.json 解析后注入） */
    title?: string;
    /** 可继续的槽位 id；空串 = 还没有存档，「继续」不可点 */
    resume?: string;
    /** 逐槽视图（宿主读好后注入，本页不自己读存档） */
    saves?: readonly SlotView[];
    /** 存档列表是否展开 */
    browsing?: boolean;
  }>(),
  { title: "", resume: "", saves: () => [], browsing: false },
);

const emit = defineEmits<{
  start: [];
  continue: [slot: string];
  toggleSaves: [];
  pickSave: [slot: string];
}>();

function pick(view: SlotView): void {
  if (view.empty) return;
  emit("pickSave", view.id);
}

function timeOf(view: SlotView): string {
  return view.timestamp === undefined
    ? ""
    : new Date(view.timestamp).toLocaleString();
}
</script>

<template>
  <section class="start-page" data-page="start">
    <h1 class="start-page__title">{{ title }}</h1>
    <div class="start-page__actions">
      <button
        class="start-page__button start-page__button--primary"
        type="button"
        @click="emit('start')"
      >
        开始
      </button>
      <button
        class="start-page__button"
        type="button"
        :disabled="resume === ''"
        :title="resume === '' ? '还没有存档，先开始一局' : '从上次的进度继续'"
        @click="emit('continue', resume)"
      >
        继续
      </button>
      <button
        class="start-page__button"
        type="button"
        :disabled="saves.length === 0"
        :aria-expanded="browsing"
        :title="saves.length === 0 ? '还没有存档' : '从某个存档继续'"
        @click="emit('toggleSaves')"
      >
        {{ browsing ? "收起存档" : "读取存档" }}
      </button>
    </div>
    <ul v-if="browsing" class="start-page__saves">
      <li v-for="view in saves" :key="view.id">
        <button
          class="start-page__save"
          type="button"
          :disabled="view.empty"
          :title="view.empty ? '空槽位' : '从这个存档继续'"
          @click="pick(view)"
        >
          <img
            v-if="view.screenshot"
            class="start-page__thumb"
            :src="view.screenshot"
            alt=""
          />
          <span v-else class="start-page__thumb start-page__thumb--empty">
            {{ view.empty ? "空" : "无预览" }}
          </span>
          <span class="start-page__meta">
            <span class="start-page__label">{{ view.label }}</span>
            <span class="start-page__save-title">{{ view.title ?? "" }}</span>
            <span class="start-page__time">{{ timeOf(view) }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.start-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(16px, 4vh, 40px);
  box-sizing: border-box;
  padding: clamp(16px, 4vw, 48px);
  background: #0a0a10;
  color: #e6e6f0;
  font-size: 17px;
}
.start-page__title {
  margin: 0;
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.start-page__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(100%, 320px);
}
.start-page__button {
  padding: 12px 20px;
  border: 1px solid rgb(230 230 240 / 22%);
  border-radius: 12px;
  background: rgb(30 30 46 / 88%);
  color: #e6e6f0;
  font-size: 16px;
  font-family: inherit;
  cursor: pointer;
}
.start-page__button:hover:not(:disabled) {
  border-color: #7aa2f7;
  color: #7aa2f7;
}
.start-page__button--primary {
  background: #7aa2f7;
  border-color: #7aa2f7;
  color: #0a0a10;
  font-weight: 600;
}
.start-page__button--primary:hover:not(:disabled) {
  background: #9ece6a;
  border-color: #9ece6a;
  color: #0a0a10;
}
.start-page__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.start-page__saves {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(100%, 440px);
  max-height: 40vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.start-page__save {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(230 230 240 / 18%);
  border-radius: 12px;
  background: rgb(24 24 38 / 92%);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.start-page__save:hover:not(:disabled) {
  border-color: #7aa2f7;
}
.start-page__save:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.start-page__thumb {
  flex: none;
  width: 96px;
  height: 54px;
  object-fit: cover;
  border-radius: 6px;
  background: rgb(0 0 0 / 40%);
}
.start-page__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  opacity: 0.6;
}
.start-page__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.start-page__label {
  font-size: 14px;
  font-weight: 600;
}
.start-page__save-title,
.start-page__time {
  overflow: hidden;
  font-size: 13px;
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
