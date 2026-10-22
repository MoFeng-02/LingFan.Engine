<script setup lang="ts">
/**
 * 中央舞台（首屏空态 / 非故事资源分派视图 / 故事四视图）。
 * 自 App.vue 抽出的装配组件：纯模板转发，视图切换经 `v-model:center-view`
 * 上抛组合根，行为与原内联模板完全一致（含各分派注释）。
 */
import type { ResourcePort, Story } from "@lingfan-engine/core";
import { type EmptyAction, type ResourceViewSpec } from "../../domain";
import { NodeGraph, StageEditor, StepLayout, StoryTimeline } from "../stage";
import { JsonResourceView, LangView, MediaView, ReadOnlyView } from "../panels";
import { EmptyState } from "../shell";

/** 媒体资源的分派形态（与 `useResourcePreview` 的 `activeMediaKind` 同型） */
type MediaKind = "image" | "audio" | "video" | "other";
/** 故事四视图（时间线 / 舞台 / 节点图 / 步骤） */
export type CenterView = "timeline" | "stage" | "graph" | "step";

const props = defineProps<{
  projectRoot: string;
  /** 是否有打开中的非故事资源（空态判据之一） */
  activeResourceOpen: boolean;
  /** 已打开文档数（空态判据之一：`documentPaths.length <= 1`） */
  openDocumentCount: number;
  dirty: boolean;
  activeSpec: ResourceViewSpec;
  activeSource: string | undefined;
  activePath: string;
  activeMediaKind: MediaKind;
  activeReadOnlyReason: string;
  readError: string;
  /** 故事四视图当前面（时间线/舞台/节点图/步骤；切换入口在顶栏） */
  centerView: CenterView;
  /** 「揭示」序号：变化即要求时间线把选中行滚入视口（由 `reveal` 自增） */
  revealTick: number;
  story: Story;
  selectedColumnId: string;
  selectedPointer: string | null;
  resourcePort: ResourcePort | undefined;
  firstSceneColumnId: string | null;
  /** 译文表/清单保存（透传 `useResourcePreview` 的 `saveTextResource`） */
  saveTextResource: (path: string, text: string) => void;
}>();

const emit = defineEmits<{
  (e: "empty-action", action: EmptyAction): void;
}>();
</script>

<template>
  <!-- 首屏空态：**未打开工程时显示空态** ——
       内存示例故事只是"可试玩"，不是"你的工程"。主动作是「打开工程」。 -->
  <EmptyState
    v-if="
      !props.projectRoot &&
      props.activeResourceOpen === false &&
      props.openDocumentCount <= 1 &&
      !props.dirty
    "
    reason="no-project"
    @action="(action: EmptyAction) => emit('empty-action', action)"
  />

  <!-- 非故事资源：按分派表走专用视图（译文表 / 清单 / 媒体 / 只读） -->
  <LangView
    v-else-if="
      props.activeSpec.view === 'lang' && props.activeSource !== undefined
    "
    :key="props.activePath"
    :path="props.activePath"
    :source="props.activeSource"
    @save="props.saveTextResource"
  />
  <JsonResourceView
    v-else-if="
      props.activeSpec.view === 'manifest' && props.activeSource !== undefined
    "
    :key="props.activePath"
    :path="props.activePath"
    :title="props.activeSpec.title"
    :source="props.activeSource"
    @save="props.saveTextResource"
  />
  <MediaView
    v-else-if="props.activeSpec.view === 'media'"
    :key="props.activePath"
    :path="props.activePath"
    :kind="props.activeMediaKind"
    :resource-port="props.resourcePort"
  />
  <ReadOnlyView
    v-else-if="props.activeSpec.view === 'readonly'"
    :path="props.activePath"
    :reason="props.activeReadOnlyReason"
  />
  <!-- 读取失败：如实展示（`readError` 必须渲染，否则失败会被静默成空白） -->
  <p v-else-if="props.readError" class="center-error">{{ props.readError }}</p>
  <p v-else-if="props.activeSpec.view !== 'story'" class="center-loading">
    正在读取资源…
  </p>

  <!-- 故事资源：四视图仍是它的内部切面（不是四类资源） -->
  <template v-else-if="props.centerView === 'timeline'">
    <StoryTimeline
      :story="props.story"
      :column-id="props.selectedColumnId"
      :selected-pointer="props.selectedPointer"
      :reveal-tick="props.revealTick"
    />
  </template>
  <StageEditor
    v-else-if="props.centerView === 'stage'"
    :story="props.story"
    :pointer="props.selectedPointer"
    :resource-port="props.resourcePort"
    :first-scene-column-id="props.firstSceneColumnId"
  />
  <!-- key = story.id ⇒ 换工程/新建/导入必重挂载，布局缓存从新工程的存储键重读 -->
  <NodeGraph
    v-else-if="props.centerView === 'graph'"
    :key="props.story.id"
    :story="props.story"
    :selected-id="props.selectedColumnId"
  />
  <!-- 步骤视图：确定性排布（无布局缓存）——key 仅用于换工程时归零选中态派生 -->
  <StepLayout
    v-else-if="props.centerView === 'step'"
    :key="props.story.id"
    :story="props.story"
    :selected-id="props.selectedColumnId"
  />
</template>
