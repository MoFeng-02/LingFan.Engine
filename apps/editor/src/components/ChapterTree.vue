<script setup lang="ts">
/**
 * **故事章节树**：左栏按「章节」组织场景（剧情/ 界面两组）。
 *
 * 为何不是平铺文件列表：工程实践里
 * `Stories/` 与 `Lang/` 常**按章节分目录**
 * （`chapter1/chapter1.story` ↔ `Lang/en-US/chapter1/chapter1.json`），
 * 三种 Lang 布局（en 平铺 / en-US 子目录 / ja 单文件）**共用同一套章节**。
 * ⇒ **内容骨架是章节，不是文件**；文件怎么摆是作者的自由。
 *
 * **两条约束（都写在这里，不在视图里另写）**：
 * ① **分组只看 `type`，绝不看目录名** —— 目录名与运行类型正交，
 *    同一目录下可能既有剧情又有界面，按目录分组会错分。
 * ② **任意深度递归** —— 「一级 = 章节」这个假设不成立；
 *    `Lang/en-US/system/about.json` 已到 2 层 ⇒ 按层数写死会错。
 *    0 层平铺工程退化为「无章节分组的全列表」，**不报错**。
 *
 * 与 `ColumnList` 的**手动分组**并存：手动分组是作者显式的编排视图，
 * 章节树是路径推导的客观结构 —— 两者语义不同，不互相取代。
 */
import { computed, inject, ref } from "vue";
import type { Story } from "@lingfan/engine";
import {
  buildChapterIndex,
  chapterSummaryText,
  sceneTypeBadgeOf,
  type ChapterInput,
  type ChapterNode,
} from "@lingfan/editor";
import { COLUMN_PATHS_KEY, EDITOR_API_KEY } from "../contracts";

const props = defineProps<{ story: Story; selectedId: string }>();

const api = inject(EDITOR_API_KEY)!;

/**
 * 路径来源：优先用工程树（多文件工程里列与路径一一对应）；
 * 退化到单文件故事（无路径概念）⇒ `path` 为空串，章节树退化为「无分组的全列表」。
 */
const paths = inject(COLUMN_PATHS_KEY);

/** 列 id → 逻辑路径（未登记时为空串） */
function pathOf(columnId: string): string {
  return paths?.value?.get(columnId) ?? "";
}

const index = computed(() => {
  const inputs: ChapterInput[] = props.story.columns.map((column) => ({
    path: pathOf(column.id),
    column,
  }));
  return buildChapterIndex(inputs);
});

/** 目录分组是否折叠（默认全展开——目录是作者的编排骨架，不该默认藏起来） */
const dirCollapsed = ref<ReadonlySet<string>>(new Set());
function isDirCollapsed(path: string): boolean {
  return dirCollapsed.value.has(path);
}
function toggleDir(path: string): void {
  const next = new Set(dirCollapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  dirCollapsed.value = next;
}

const summary = computed(() => chapterSummaryText(index.value));

/**
 * 两组共用的渲染数据（**目录跟着组走**）。
 *
 * `dirs` 必须取**按组过滤**版（`storyDirs` / `uiDirs`）：目录是作者的编排、
 * `type` 是运行语义，两者**正交**（一个目录可同时含剧情与界面）。
 * 用全局 `dirs` 会把剧情节点混进界面组，而剧情组本身退化成平铺
 * （同一个章节名会在列表里重复出现）。
 */
const groups = computed(() =>
  (
    [
      {
        key: "story",
        label: "剧情",
        nodes: index.value.story,
        dirs: index.value.storyDirs,
        hint: null,
        titleSuffix: "（可回溯、可存档）",
      },
      {
        key: "ui",
        label: "界面",
        nodes: index.value.ui,
        dirs: index.value.uiDirs,
        hint: "不参与存档与回溯",
        titleSuffix: "（不参与存档与回溯）",
      },
    ] as const
  ).filter((grp) => grp.nodes.length > 0),
);

/** 类型徽标（精确到 菜单/界面，文案单一事实源 = `sceneTypeBadgeOf`）：
 * `type` 缺省 = game（story 组）不显示徽标——避免满屏都是「剧情」。
 * group=ui ⇔ type∈{menu,ui}（isReplayableColumn 判定）⇒ 徽标必有值。 */
function badgeOf(node: ChapterNode): string | null {
  if (node.group === "story") return null; // game 是常态，不标
  return sceneTypeBadgeOf(node.type);
}
</script>

<template>
  <div class="chapter-tree">
    <p v-if="props.story.columns.length === 0" class="ch-empty">
      尚无场景（新建一列开始创作）
    </p>

    <template v-else>
      <p class="ch-summary" :title="`共 ${summary}`">{{ summary }}</p>

      <!-- 两组共用一份结构（数据驱动）。
           **目录跟着组走**：目录是作者编排、`type` 是运行语义，两者正交——
           一个目录可同时含剧情与界面。
           故用**按组过滤**的 `storyDirs`/`uiDirs`；用全局 `dirs` 会把剧情节点混进界面组，
           剧情组本身也会退化成平铺（章节名重复出现）。 -->
      <section v-for="grp in groups" :key="grp.key" class="ch-group">
        <h3 class="ch-group-head">
          <span class="ch-dot" :class="grp.key" aria-hidden="true"></span>
          {{ grp.label }}
          <span class="ch-count">{{ grp.nodes.length }}</span>
        </h3>
        <p v-if="grp.hint !== null" class="ch-hint">{{ grp.hint }}</p>

        <!-- 目录分组（任意深度；0 层平铺时无目录 ⇒ 直接平铺） -->
        <template v-if="grp.dirs.length > 0">
          <div v-for="dir in grp.dirs" :key="dir.path" class="ch-dir">
            <button
              class="ch-dir-head"
              :aria-expanded="!isDirCollapsed(dir.path)"
              @click="toggleDir(dir.path)"
            >
              <span class="ch-caret" aria-hidden="true">{{
                isDirCollapsed(dir.path) ? "▸" : "▾"
              }}</span>
              {{ dir.label }}
            </button>
            <ul v-if="!isDirCollapsed(dir.path)" class="ch-list">
              <li v-for="node in dir.children" :key="node.id">
                <button
                  class="ch-item"
                  :class="{ active: node.id === props.selectedId }"
                  :aria-current="node.id === props.selectedId"
                  :title="`${node.id} · ${node.commandCount} 条命令${grp.titleSuffix}`"
                  @click="api.selectColumn(node.id)"
                >
                  <!-- 分组视图里显示**列名**（`node.id`）而**不是** `node.label`：
                       「章节名」已由目录标题承担，节点若仍用 label 会在目录下重复同一个名字。
                       列 id 才是能区分场景的标识（时间线/诊断也都用它）。 -->
                  <span class="ch-label">{{ node.id }}</span>
                  <span v-if="badgeOf(node)" class="ch-badge">{{ badgeOf(node) }}</span>
                  <span class="ch-meta">{{ node.commandCount }}</span>
                </button>
              </li>
            </ul>
          </div>
        </template>

        <!-- 无目录（平铺工程）⇒ 直接列出，避免「目录标题都没有」的困惑 -->
        <ul v-else class="ch-list">
          <li v-for="node in grp.nodes" :key="node.id">
            <button
              class="ch-item"
              :class="{ active: node.id === props.selectedId }"
              :aria-current="node.id === props.selectedId"
              :title="`${node.id} · ${node.commandCount} 条命令${grp.titleSuffix}`"
              @click="api.selectColumn(node.id)"
            >
              <span class="ch-label">{{ node.label }}</span>
              <span v-if="badgeOf(node)" class="ch-badge">{{ badgeOf(node) }}</span>
              <span class="ch-meta">{{ node.commandCount }}</span>
            </button>
          </li>
        </ul>
      </section>

    </template>
  </div>
</template>

<style scoped>
.chapter-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.ch-empty {
  color: var(--lf-text-hint);
  padding: 8px 10px;
  font-size: var(--lf-font-sm);
}
.ch-summary {
  margin: 0 0 4px;
  padding: 4px 10px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
}
.ch-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 5px 10px;
  font-size: var(--lf-font-sm);
  font-weight: 500;
  color: var(--lf-text-secondary);
  border-bottom: 1px solid var(--lf-border-subtle);
}
.ch-count {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-variant-numeric: tabular-nums;
}
.ch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ch-dot.story {
  background: var(--lf-accent);
}
.ch-dot.ui {
  background: var(--lf-warning);
}
.ch-hint {
  margin: 2px 10px 4px;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
.ch-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.ch-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 10px 4px 22px;
  text-align: left;
  color: var(--lf-text-primary);
}
.ch-item:hover {
  background: var(--lf-surface-hover);
}
.ch-item.active {
  background: var(--lf-surface-selected);
  color: var(--lf-text-primary);
}
.ch-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ch-badge {
  flex-shrink: 0;
  padding: 0 5px;
  font-size: var(--lf-font-xs);
  line-height: 15px;
  color: var(--lf-warning);
  border: 1px solid var(--lf-border-subtle);
  border-radius: 7px;
}
.ch-meta {
  flex-shrink: 0;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
  font-variant-numeric: tabular-nums;
}
.ch-dir-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  /* 缩进必须**小于**子节点：原名文字起点 = 14 + caret10 + gap4 = 28px，
     而 `.ch-item` 是 22px ⇒ 目录名反而落在子节点**右边**（层级感反了）。
     改为 4px ⇒ 文字起点 18px，与子节点（30px）拉开 12px 的层级差。 */
  padding: 3px 10px 3px 4px;
  text-align: left;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
}
/* 目录**内**的节点再缩进一档（平铺视图保持原地不动） */
.ch-dir .ch-item {
  padding-left: 30px;
}
.ch-dir-head:hover {
  background: var(--lf-surface-hover);
}
.ch-caret {
  width: 10px;
  flex-shrink: 0;
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
}
</style>
