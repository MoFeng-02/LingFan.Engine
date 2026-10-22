<script setup lang="ts">
/**
 * 右栏面板（属性 / 诊断 / JSON / 文本 / 本地化 / 打包 + 宽度拖拽）。
 * 自 App.vue 抽出的装配组件：纯模板转发，不持有业务状态（tab 归属由
 * `v-model:right-tab` 上抛组合根，行为与原内联模板完全一致）。
 */
import type { Diagnostic } from "@lingfan-engine/editor";
import type { Story } from "@lingfan-engine/core";
import type { PackRequest, PackResult } from "../../contracts";
import { MAX_RIGHT_WIDTH, MIN_RIGHT_WIDTH } from "../../infra";
import {
  DiagnosticsPanel,
  JsonView,
  LangWorkbench,
  PackPanel,
  PropertyPanel,
  TextModeView,
  type LangSummary,
} from "../panels";
import { PaneSplitter } from "../shell";

/** 右栏互斥视图（打包页不在 tab 内：入口在状态栏，见下方注释） */
export type RightTab =
  "property" | "diagnostics" | "json" | "text" | "i18n" | "pack";

const props = defineProps<{
  rightCollapsed: boolean;
  rightWidth: number;
  rightTab: RightTab;
  story: Story;
  pointer: string | null;
  diagnostics: Diagnostic[];
  i18nSources: readonly string[];
  i18nLangs: readonly LangSummary[];
  localHostAvailable: boolean;
  packing: boolean;
  send: (request: PackRequest) => Promise<PackResult>;
}>();

const emit = defineEmits<{
  (e: "update:rightTab", value: RightTab): void;
  (e: "open-resource", path: string): void;
  (
    e: "generate",
    request: {
      lang: string;
      layout: import("@lingfan-engine/editor").SkeletonLayoutChoice;
    },
  ): void;
  (e: "toggle-pack"): void;
  (e: "resize", width: number): void;
}>();

function select(tab: RightTab): void {
  emit("update:rightTab", tab);
}
</script>

<template>
  <aside
    v-show="!props.rightCollapsed"
    class="pane right-pane"
    :style="{ width: `${props.rightWidth}px` }"
  >
    <!-- a11y：tablist 语义 —— 右栏与左栏的 tab 若都是裸 button，
         读屏只知道「6 个按钮」，不知道它们是互斥视图切换。 -->
    <div class="tab-strip" role="tablist" aria-label="右栏面板">
      <button
        role="tab"
        :aria-selected="props.rightTab === 'property'"
        :class="{ active: props.rightTab === 'property' }"
        @click="select('property')"
      >
        属性
      </button>
      <button
        role="tab"
        :aria-selected="props.rightTab === 'diagnostics'"
        :class="{ active: props.rightTab === 'diagnostics' }"
        @click="select('diagnostics')"
      >
        诊断
      </button>
      <button
        role="tab"
        :aria-selected="props.rightTab === 'json'"
        :class="{ active: props.rightTab === 'json' }"
        @click="select('json')"
      >
        JSON
      </button>
      <button
        role="tab"
        :aria-selected="props.rightTab === 'text'"
        :class="{ active: props.rightTab === 'text' }"
        @click="select('text')"
      >
        文本
      </button>
      <!-- 本地化工作台（聚合面：多语言覆盖率 / 缺译清单 / 骨架生成） -->
      <button
        role="tab"
        :aria-selected="props.rightTab === 'i18n'"
        :class="{ active: props.rightTab === 'i18n' }"
        title="本地化：多语言覆盖率与译文表骨架"
        @click="select('i18n')"
      >
        本地化
      </button>
      <!-- 打包**不作为右栏 tab**：低频动作（以分钟计），
         不占一级 tab；入口移到**状态栏**（带文字标签按钮，toggle 打包页）。 -->
    </div>
    <!-- 属性面板在右栏首 tab：中央时间线拿回全部高度。 -->
    <PropertyPanel
      v-show="props.rightTab === 'property'"
      :story="props.story"
      :pointer="props.pointer"
    />
    <DiagnosticsPanel
      v-show="props.rightTab === 'diagnostics'"
      :diagnostics="props.diagnostics"
    />
    <JsonView v-show="props.rightTab === 'json'" :story="props.story" />
    <TextModeView v-show="props.rightTab === 'text'" :story="props.story" />
    <!-- 本地化工作台：数据全部来自既有诊断供给（**零新增 IO**） -->
    <LangWorkbench
      v-show="props.rightTab === 'i18n'"
      :sources="props.i18nSources"
      :langs="props.i18nLangs"
      @open="(path: string) => emit('open-resource', path)"
      @generate="(request) => emit('generate', request)"
    />
    <!-- 快速打包：**前端不 spawn 进程**，只转发给本地宿主 -->
    <PackPanel
      v-show="props.rightTab === 'pack'"
      :can-pack="props.localHostAvailable"
      :send="props.send"
    />
  </aside>
  <PaneSplitter
    v-if="!props.rightCollapsed"
    :size="props.rightWidth"
    :min="MIN_RIGHT_WIDTH"
    :max="MAX_RIGHT_WIDTH"
    side="right"
    label="调整属性栏宽度"
    @resize="(width: number) => emit('resize', width)"
  />
</template>
