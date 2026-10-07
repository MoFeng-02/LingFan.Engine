<script setup lang="ts">
/**
 * 本地化工作台（`Lang/**` 的**聚合面**）。
 *
 * 存在理由：既有 `LangView` 是**单文件译文表编辑器**（一个 `Lang/en/main.json`
 * 一张表），而译者真正要面对的是「**这个语言到什么程度了 / 还缺哪些 / 怎么建新语言**」
 * —— 这些是**跨文件**的问题，单文件视图答不了。本组件提供三件事：
 *
 * ① **多语言枚举 + 覆盖率**（消费 `workbenchOverview`，判据在纯函数里）；
 * ② **缺译清单**（点击跳到该语言的译文表，逐条改）；
 * ③ **骨架生成**（新语言一键铺文件，委托 `planOverlaySkeleton`，落盘由宿主做）。
 *
 * 约束：本组件**不碰 IO**（与其它编辑器视图同一约束）—— 读用宿主注入的 `files`，
 * 写经 `generate` 事件回抛给组合根。
 */
import { computed, ref } from "vue";
import {
  coverageLabelOf,
  coveragePercentOf,
  coverageWeightedPercentOf,
  coverageStateOf,
  workbenchOverview,
  type SkeletonLayoutChoice,
} from "@lingfan/editor";
import { useDialog } from "../dialogInjection";

/** 一个语言的聚合态（宿主供给，不在本组件解析文件） */
export interface LangSummary {
  /** 语言码（`en` / `zh-CN`…） */
  readonly lang: string;
  /** 该语言的 overlay 文件（路径 → 键集合） */
  readonly files: ReadonlyMap<string, readonly string[]>;
}

const props = defineProps<{
  /** 原文键全集（`extractStoryKeys(story)`） */
  sources: readonly string[];
  /** 各语言的键集合（宿主枚举 `Lang/**` 得出） */
  langs: readonly LangSummary[];
}>();

const emit = defineEmits<{
  /** 跳到某语言的某张译文表 */
  (e: "open", path: string): void;
  /** 生成骨架（宿主落盘；本组件不写文件） */
  (e: "generate", request: { lang: string; layout: SkeletonLayoutChoice }): void;
}>();

const dialog = useDialog();

/** 该语言第一张译文表路径（无文件时指向约定的 `main.json`） */
function firstPathOf(lang: string): string | undefined {
  const found = props.langs.find((l) => l.lang === lang);
  if (found === undefined) return undefined;
  const first = [...found.files.keys()][0];
  return first === undefined ? `Lang/${lang}/main.json` : first;
}

/** 聚合覆盖率（判据全在纯函数里） */
const overview = computed(() =>
  workbenchOverview(
    props.sources,
    Object.fromEntries(props.langs.map((l) => [l.lang, [...l.files.values()].flat()])),
  ),
);

/** 展开查看缺译明细的语言（默认全收，避免一屏铺满） */
const expanded = ref<string | null>(null);

/** 骨架生成表单（默认 `main` 布局 —— 与既有 `Lang/{lang}/main.json` 一致） */
const newLang = ref("");
const newLayout = ref<SkeletonLayoutChoice>("main");

async function onGenerate(): Promise<void> {
  const lang = newLang.value.trim();
  if (lang === "") {
    // 留空 = 用户还没填 ⇒ 说清要什么，不静默失败
    await dialog.notify({
      title: "请先填写语言码",
      message: "语言码将作为目录名（如 en、zh-CN），须为单段安全文件名。",
      tone: "warning",
    });
    return;
  }
  if (props.langs.some((l) => l.lang === lang)) {
    const ok = await dialog.askConfirm({
      title: `语言「${lang}」已存在`,
      message: "仍要生成骨架吗？已有译文会被保留（增量模式），但可能覆盖同名文件。",
      danger: true,
    });
    if (!ok) return;
  }
  emit("generate", { lang, layout: newLayout.value });
  newLang.value = "";
}

/** 跳到该语言的第一张译文表（无文件时指向约定的 `main.json`） */
function open(lang: string): void {
  const path = firstPathOf(lang);
  if (path !== undefined) emit("open", path);
}
</script>

<template>
  <div class="workbench">
    <header class="wb-head">
      <h2 class="wb-title">本地化</h2>
      <span class="wb-total">原文 {{ overview.totalSources }} 条</span>
    </header>

    <!-- 空语言：不是"没有数据"而是"还没建语言" ⇒ 给主动作 -->
    <div v-if="overview.coverages.length === 0" class="wb-empty">
      <p class="wb-empty-title">尚未建立任何语言</p>
      <p class="wb-empty-hint">在下方填写语言码，生成译文表骨架后即可开始翻译。</p>
    </div>

    <ul v-else class="wb-langs">
      <li v-for="c in overview.coverages" :key="c.lang" class="wb-lang">
        <div class="wb-lang-row">
          <button class="wb-lang-name" :title="`打开 ${c.lang} 的译文表`" @click="open(c.lang)">
            {{ c.lang }}
          </button>
          <span
            class="wb-ratio"
            :data-state="coverageStateOf(c)"
            :title="`按**字数**加权 ${coverageWeightedPercentOf(c)}（长句权重更大）· 按条数 ${coveragePercentOf(c)} · 原文 ${c.totalChars} 字`"
          >
            {{ coverageWeightedPercentOf(c) }}
          </span>
          <span class="wb-state">{{ coverageLabelOf(coverageStateOf(c)) }}</span>
          <span class="wb-count">{{ c.translated }}/{{ c.total }}</span>
          <button
            v-if="c.missing.length > 0"
            class="mini"
            :title="`展开缺译清单（${c.missing.length} 条）`"
            @click="expanded = expanded === c.lang ? null : c.lang"
          >
            {{ expanded === c.lang ? "收起" : "缺译" }}
          </button>
        </div>
        <ul v-if="expanded === c.lang && c.missing.length > 0" class="wb-missing">
          <li v-for="k in c.missing" :key="k" class="wb-missing-item">
            <span class="wb-key">{{ k }}</span>
            <button class="mini" title="打开该语言的译文表并定位" @click="open(c.lang)">去译</button>
          </li>
        </ul>
        <p v-if="c.unused.length > 0" class="wb-unused">
          多译 {{ c.unused.length }} 条（原文已无对应文本）
        </p>
      </li>
    </ul>

    <p v-if="overview.unusedAll.length > 0" class="wb-unused-all">
      全部语言合计多译 {{ overview.unusedAll.length }} 条 —— 与诊断面板的「多余译文」同源。
    </p>

    <!-- 骨架生成 -->
    <section class="wb-gen">
      <h3 class="wb-gen-title">新建语言</h3>
      <div class="wb-gen-row">
        <input
          v-model="newLang"
          class="control"
          placeholder="语言码，如 en / zh-CN"
          @keydown.enter.prevent="onGenerate"
        />
        <select v-model="newLayout" class="control">
          <option value="main">按主表（Lang/{lang}/main.json）</option>
          <option value="single">单文件（Lang/{lang}.json）</option>
          <option value="per-story">按故事镜像</option>
        </select>
        <button class="wb-gen-btn" @click="onGenerate">生成骨架</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  overflow: auto;
}
.wb-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.wb-title {
  margin: 0;
  font-size: var(--lf-font-lg);
  color: var(--lf-text-primary);
}
.wb-total {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.wb-empty {
  padding: 20px 12px;
  text-align: center;
}
.wb-empty-title {
  margin: 0 0 4px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
}
.wb-empty-hint {
  margin: 0;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.wb-langs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wb-lang {
  padding: 6px 8px;
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-md);
}
.wb-lang-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wb-lang-name {
  min-width: 72px;
  padding: 2px 8px;
  font-family: var(--lf-font-mono);
  text-align: left;
}
.wb-ratio {
  font-variant-numeric: tabular-nums;
  color: var(--lf-text-secondary);
}
.wb-ratio[data-state="complete"] {
  color: var(--lf-success);
}
.wb-ratio[data-state="untranslated"] {
  color: var(--lf-text-hint);
}
.wb-ratio[data-state="empty"] {
  color: var(--lf-text-hint);
}
.wb-state {
  flex: 1;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.wb-count {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-variant-numeric: tabular-nums;
}
.wb-missing {
  margin: 6px 0 0;
  padding: 0 0 0 8px;
  list-style: none;
  border-left: 1px solid var(--lf-border-subtle);
}
.wb-missing-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.wb-key {
  flex: 1;
  font-family: var(--lf-font-mono);
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  overflow-wrap: anywhere;
}
.wb-unused,
.wb-unused-all {
  margin: 6px 0 0;
  font-size: var(--lf-font-sm);
  color: var(--lf-warning);
}
.wb-gen {
  padding-top: 10px;
  border-top: 1px solid var(--lf-border-subtle);
}
.wb-gen-title {
  margin: 0 0 6px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-secondary);
}
.wb-gen-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wb-gen-btn {
  white-space: nowrap;
}
</style>
