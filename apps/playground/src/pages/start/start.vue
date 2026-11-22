<script setup lang="ts">
/**
 * 标题屏：进游戏之前的门面，与引擎无关——它不订阅状态、不读引擎，
 * 只把「开始旅程 / 继续 / 展开存档列表 / 选一个存档 / 功能巡览 / 换语言」
 * 几个意图回抛宿主，由宿主决定何时让引擎跑起来、进哪一列。
 *
 * 没有存档时「继续」与「读取存档」都不可点：按钮 disabled 并给出提示，
 * 避免玩家点了没反应；有最近存档时在「继续」下方展示那一槽的进度摘要。
 * 展开后列的是宿主递来的逐槽视图，空槽同样不可点——「从空槽继续」本来
 * 就无从做起，交给引擎只会换回一条读档失败。
 *
 * 文案一律经 `t` 门面查译文（未命中回原文），与工具条同一套 i18n 供给。
 */
import { computed } from "vue";
import type { SlotView } from "@lingfan-engine/shell";

const props = withDefaults(
  defineProps<{
    /** 工程标题（组合根从 project.json 解析后注入） */
    title?: string;
    /** 可继续的槽位 id；空串 = 还没有存档，「继续」不可点 */
    resume?: string;
    /** 逐槽视图（宿主读好后注入，本页不自己读存档） */
    saves?: readonly SlotView[];
    /** 存档列表是否展开 */
    browsing?: boolean;
    /** 可选语言清单（宿主供给；多于一门才显示切换器） */
    availableLangs?: readonly string[];
    /** 当前语言（空串 = 跟随默认） */
    currentLang?: string;
    /** 译文门面：查不到回原文，组件不持有词典 */
    t?: (text: string) => string;
  }>(),
  {
    title: "",
    resume: "",
    saves: () => [],
    browsing: false,
    availableLangs: () => [],
    currentLang: "",
  },
);

const emit = defineEmits<{
  start: [];
  continue: [slot: string];
  toggleSaves: [];
  pickSave: [slot: string];
  tour: [];
  "change-lang": [lang: string];
}>();

const t = (text: string): string => props.t?.(text) ?? text;

/** 背景图：逻辑路径按资源根写，走绑定而不是静态属性——静态 `src` 会被构建器当模块去解析 */
const BACKDROP = "Images/worldmap.svg";

/** 最近存档的进度摘要：从逐槽视图里找「继续」指向的那一槽；找不到就不展示 */
const resumeView = computed(() =>
  props.saves.find((view) => view.id === props.resume && !view.empty),
);

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
    <img
      class="start-page__backdrop"
      :src="BACKDROP"
      alt=""
      aria-hidden="true"
    />
    <div class="start-page__shade" aria-hidden="true"></div>
    <select
      v-if="availableLangs.length > 1"
      class="start-page__lang"
      :value="currentLang"
      :aria-label="t('语言')"
      @change="emit('change-lang', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ t("默认") }}</option>
      <option v-for="lang in availableLangs" :key="lang" :value="lang">
        {{ lang }}
      </option>
    </select>
    <div class="start-page__hero">
      <h1 class="start-page__title">{{ title }}</h1>
      <p class="start-page__subtitle">
        {{ t("每处界面，都是一项真实的引擎能力") }}
      </p>
    </div>
    <div class="start-page__actions">
      <button
        class="start-page__button start-page__button--primary"
        type="button"
        @click="emit('start')"
      >
        {{ t("开始旅程") }}
      </button>
      <button
        class="start-page__button"
        type="button"
        :disabled="resume === ''"
        :title="
          resume === '' ? t('还没有存档，先开始一局') : t('从上次的进度继续')
        "
        @click="emit('continue', resume)"
      >
        {{ t("继续") }}
      </button>
      <p v-if="resumeView" class="start-page__resume">
        <span class="start-page__resume-label">{{ t("最近进度") }}</span>
        <span>{{ resumeView.label }}</span>
        <span v-if="resumeView.title">{{ resumeView.title }}</span>
        <span v-if="timeOf(resumeView)">{{ timeOf(resumeView) }}</span>
      </p>
      <button
        class="start-page__button"
        type="button"
        :disabled="saves.length === 0"
        :aria-expanded="browsing"
        :title="saves.length === 0 ? t('还没有存档') : t('从某个存档继续')"
        @click="emit('toggleSaves')"
      >
        {{ browsing ? t("收起存档") : t("读取存档") }}
      </button>
      <button
        class="start-page__button"
        type="button"
        :title="t('直达引擎功能巡览')"
        @click="emit('tour')"
      >
        {{ t("功能巡览") }}
      </button>
    </div>
    <ul v-if="browsing" class="start-page__saves">
      <li v-for="view in saves" :key="view.id">
        <button
          class="start-page__save"
          type="button"
          :disabled="view.empty"
          :title="view.empty ? t('空槽位') : t('从这个存档继续')"
          @click="pick(view)"
        >
          <img
            v-if="view.screenshot"
            class="start-page__thumb"
            :src="view.screenshot"
            alt=""
          />
          <span v-else class="start-page__thumb start-page__thumb--empty">
            {{ view.empty ? t("空") : t("无预览") }}
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
.start-page__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.start-page__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(10 10 16 / 62%), rgb(10 10 16 / 88%));
}
.start-page__lang {
  position: absolute;
  top: clamp(12px, 2vh, 24px);
  right: clamp(12px, 2vw, 24px);
  padding: 6px 10px;
  border: 1px solid rgb(230 230 240 / 22%);
  border-radius: 8px;
  background: rgb(30 30 46 / 88%);
  color: #e6e6f0;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.start-page__hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.start-page__title {
  margin: 0;
  font-family: serif;
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.start-page__subtitle {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.06em;
  opacity: 0.75;
}
.start-page__actions {
  position: relative;
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
.start-page__resume {
  display: flex;
  gap: 8px;
  margin: -4px 0 0;
  overflow: hidden;
  font-size: 13px;
  opacity: 0.72;
  white-space: nowrap;
}
.start-page__resume-label {
  flex: none;
  color: #7aa2f7;
}
.start-page__resume span:not(.start-page__resume-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.start-page__saves {
  position: relative;
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
