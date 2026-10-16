<script setup lang="ts">
/**
 * 左侧栏（资源树 / 内容搜索 / 最近 / 章节树 / 列分组 / 组件面板 + 宽度拖拽）。
 * 自 App.vue 抽出的装配组件：纯模板转发，tab 与搜索词经 `v-model` 上抛组合根，
 * 行为与原内联模板完全一致（含各页的常驻说明与 a11y 注释）。
 */
import type { Story } from "@lingfan/engine";
import { searchResources, type ResourceNode } from "../../domain";
import { LEFT_TABS, type LeftTab } from "../../app/leftTabs";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "../../infra";
import { ChapterTree, ResourceTreeView } from "../sidebar";
import { ColumnList } from "../panels";
import { ComponentPalette } from "../stage";
import { PaneSplitter } from "../shell";

/** 内容搜索报告（`searchResources` 的返回形态，用于 prop 类型标注） */
type SearchReport = ReturnType<typeof searchResources>;
/** 资源过滤判据（名称 / 路径匹配） */
type ResourceFilter = (node: ResourceNode) => boolean;

const props = defineProps<{
  leftCollapsed: boolean;
  leftWidth: number;
  leftTab: LeftTab;
  searchKeyword: string;
  resourceNodes: readonly ResourceNode[];
  resourceFocusPath: string | undefined;
  projectId: string;
  /** 工程级树（`projectTree ?? story`）：章节树与列树都取整工程视野 */
  wholeStory: Story;
  selectedColumnId: string;
  activeDocumentPath: string | undefined;
  searchReport: SearchReport;
  searchFilter: ResourceFilter;
  recentFilter: ResourceFilter;
}>();

const emit = defineEmits<{
  (e: "update:leftTab", value: LeftTab): void;
  (e: "update:searchKeyword", value: string): void;
  (e: "open-resource", path: string): void;
  (e: "resize", width: number): void;
}>();

function openResource(path: string): void {
  emit("open-resource", path);
}
function select(tab: LeftTab): void {
  emit("update:leftTab", tab);
}
</script>

<template>
  <!-- 侧栏：可拖宽 / 可折叠 -->
  <aside
    v-show="!props.leftCollapsed"
    class="pane columns-pane"
    :style="{ width: `${props.leftWidth}px` }"
  >
    <div class="tab-strip left-tabs" role="tablist" aria-label="侧栏视图">
      <button
        v-for="tab in LEFT_TABS"
        :key="tab.id"
        role="tab"
        :aria-selected="props.leftTab === tab.id"
        :class="{ active: props.leftTab === tab.id }"
        :title="tab.hint"
        @click="select(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <input
      v-if="props.leftTab === 'search'"
      :value="props.searchKeyword"
      class="side-search"
      type="search"
      placeholder="搜索资源名或路径…"
      aria-label="搜索资源"
      @input="
        emit('update:searchKeyword', ($event.target as HTMLInputElement).value)
      "
    />
    <div v-show="props.leftTab === 'resources'" class="left-pane-body">
      <!-- 收展持久化只接资源模式实例：搜索/最近是扁平列表，无折叠面 -->
      <ResourceTreeView
        :nodes="props.resourceNodes"
        :active-path="props.resourceFocusPath"
        :project-id="props.projectId"
        @open="openResource"
      />
    </div>
    <div v-show="props.leftTab === 'search'" class="left-pane-body">
      <!-- 内容搜索结果（先于名称匹配，因为它更精确） -->
      <ul v-if="props.searchReport.hits.length > 0" class="hits">
        <li
          v-for="(hit, i) in props.searchReport.hits"
          :key="`${hit.path}:${hit.line}:${i}`"
        >
          <button
            class="hit"
            :title="`${hit.path}:${hit.line}`"
            @click="openResource(hit.path)"
          >
            <span class="hit-path"
              >{{ hit.path }}<span class="hit-line">:{{ hit.line }}</span></span
            >
            <span class="hit-text">{{ hit.text.trim().slice(0, 80) }}</span>
          </button>
        </li>
      </ul>
      <p v-if="props.searchReport.truncated" class="hits-more">
        已达上限，还有更多结果
      </p>
      <p
        v-if="
          props.searchKeyword.trim() !== '' &&
          props.searchReport.searchedFiles > 0 &&
          props.searchReport.hits.length === 0
        "
        class="hits-none"
      >
        内容中无匹配
      </p>
      <ResourceTreeView
        :nodes="props.resourceNodes"
        :active-path="props.activeDocumentPath"
        :filter="props.searchFilter"
        @open="openResource"
      />
    </div>
    <div v-show="props.leftTab === 'recent'" class="left-pane-body">
      <ResourceTreeView
        :nodes="props.resourceNodes"
        :active-path="props.activeDocumentPath"
        :filter="props.recentFilter"
        @open="openResource"
      />
    </div>
    <!-- v-show 必须落在**单根元素**上：ColumnList 是多根模板，直接给它 v-show 会让指令失效
         （Vue: "Runtime directive used on component with non-element root node"）⇒ 命令面板不会隐藏 -->
    <!-- **章节树**：内容骨架是「章节」而不是文件——
         `Stories/chapter1/chapter1.story`、`Stories/system/about.story`
         都是作者的编排，平铺几十个文档会让人失去结构感。
         ① 取**整工程树**（喂单列切片则只剩一列，用户失去「工程里有哪些列」的视野）
         ② 路径面经 `columnPaths` 注入（章节 = 路径目录）
         ③ 选列 = 切标签（`api.selectColumn` 内部完成，同一动作不重复实现） -->
    <div v-show="props.leftTab === 'chapters'" class="left-pane-body">
      <!-- 常驻说明：「章节」与「列」都是"工程里的列"，光看名字分不出区别。
           tab 的 `title` 只在悬停时可见 ⇒ 面板顶部给一行**常驻**口径说明。 -->
      <p class="left-pane-note">按文件路径分章（目录即章节）</p>
      <ChapterTree
        :story="props.wholeStory"
        :selected-id="props.selectedColumnId"
      />
    </div>
    <!-- v-show 必须落在**单根元素**上：ColumnList 是多根模板，直接给它 v-show 会让指令失效
         （Vue: "Runtime directive used on component with non-element root node"）⇒ 命令面板不会隐藏 -->
    <div v-show="props.leftTab === 'columns'" class="left-pane-body">
      <!-- 常驻说明（与「章节」对称）：说清这一页是**作者手动分组**，与目录结构无关 -->
      <p class="left-pane-note">按手动分组排列（与目录无关）</p>
      <!-- 列树取**整工程树**（工程级视图）：活动文档是单列切片，
           若喂切片则列树只剩一列，用户失去「工程里有哪些列」的视野。
           选列 = 切标签（`api.selectColumn` 内部完成，两者同一动作不重复实现）。 -->
      <ColumnList
        :story="props.wholeStory"
        :selected-id="props.selectedColumnId"
      />
    </div>
    <div v-show="props.leftTab === 'palette'" class="left-pane-body">
      <ComponentPalette />
    </div>
  </aside>
  <PaneSplitter
    v-if="!props.leftCollapsed"
    :size="props.leftWidth"
    :min="MIN_SIDEBAR_WIDTH"
    :max="MAX_SIDEBAR_WIDTH"
    side="left"
    label="调整侧栏宽度"
    @resize="(width: number) => emit('resize', width)"
  />
</template>
