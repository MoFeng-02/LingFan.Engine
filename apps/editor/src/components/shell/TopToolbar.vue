<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { Ref } from "vue";
import type { LastProjectEntry } from "../../contracts";

/**
 * 顶栏（瘦身）：
 * 原则 = **顶栏不放编辑动作**（同 VS Code）——它只回答两件事：
 * 「我在哪个工程」与「我在看哪个视图」。编辑/文件动作走右侧「⋯」菜单（保留快捷键），
 * 状态量（未保存 / 可回溯步数 / 诊断数）走底部状态栏 —— 那是**状态**不是**动作**。
 */
defineProps<{
  /** 工程根名（空 = 未绑定磁盘工程，chip 显示示例故事 id） */
  projectRoot: string;
  projectName: string;
  storyId: string;
  /** chip tooltip（工程根全路径 + 宿主监视根说明） */
  projectChipTitle: string;
  lastProject?: Ref<LastProjectEntry | undefined>;
  canSave: boolean;
  saveTooltip: string;
  saving: boolean;
  undoDepth: number;
  redoDepth: number;
  /** 中心视图（v-model:center-view） */
  centerView: "timeline" | "stage" | "graph" | "step";
}>();

const emit = defineEmits<{
  (e: "open-project"): void;
  (e: "reopen-last"): void;
  (e: "preview"): void;
  (e: "save"): void;
  (e: "undo"): void;
  (e: "redo"): void;
  (e: "import-json"): void;
  (e: "export"): void;
  (e: "new"): void;
  (
    e: "update:centerView",
    value: "timeline" | "stage" | "graph" | "step",
  ): void;
}>();

/** 「⋯」溢出菜单开合（点击外部/Esc 关闭见下方两个处理器） */
const toolMenuOpen = ref(false);
const toolMenuAnchor = ref<HTMLElement | null>(null);

/**
 * 「⋯」菜单的关闭时机（**可访问性底线**：键盘用户必须能退出）。
 * - `Esc` 关闭；
 * - 点击菜单**外部**关闭；
 * - 少了这两条，菜单就只能靠再点同一个按钮收起 ⇒ 键盘用户被卡住。
 */
function onToolMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    toolMenuOpen.value = false;
    event.stopPropagation();
  }
}
function onDocumentPointerDown(event: PointerEvent): void {
  if (!toolMenuOpen.value) return;
  const target = event.target as Node | null;
  if (target !== null && toolMenuAnchor.value?.contains(target)) return;
  toolMenuOpen.value = false;
}

onMounted(() =>
  document.addEventListener("pointerdown", onDocumentPointerDown),
);
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", onDocumentPointerDown),
);
</script>

<template>
  <header class="toolbar">
    <!-- 左：工程标识（品牌弱化 + 工程名/路径合并为一个 chip） -->
    <div class="tb-group tb-left">
      <strong class="brand" title="灵泛编辑器">灵泛</strong>
      <button
        class="project-chip btn-tonal"
        :title="projectChipTitle"
        @click="emit('open-project')"
      >
        <span class="project-chip-name">{{
          projectRoot !== "" ? projectName : storyId
        }}</span>
        <span v-if="projectRoot !== ''" class="project-chip-path">{{
          projectRoot
        }}</span>
      </button>
      <button
        v-if="lastProject?.value !== undefined"
        class="icon-button"
        :title="`一键重开上次工程「${lastProject.value.name}」`"
        :aria-label="`一键重开上次工程「${lastProject.value.name}」`"
        @click="emit('reopen-last')"
      >
        ↺
      </button>
    </div>

    <!-- 中：视图切换（居中，唯一常驻的"模式"切换） -->
    <div class="view-switch" role="tablist" aria-label="中心视图">
      <button
        role="tab"
        :aria-selected="centerView === 'timeline'"
        :class="{ active: centerView === 'timeline' }"
        @click="emit('update:centerView', 'timeline')"
      >
        时间线
      </button>
      <button
        role="tab"
        :aria-selected="centerView === 'stage'"
        :class="{ active: centerView === 'stage' }"
        @click="emit('update:centerView', 'stage')"
      >
        舞台
      </button>
      <button
        role="tab"
        :aria-selected="centerView === 'graph'"
        :class="{ active: centerView === 'graph' }"
        @click="emit('update:centerView', 'graph')"
      >
        节点图
      </button>
      <button
        role="tab"
        :aria-selected="centerView === 'step'"
        :class="{ active: centerView === 'step' }"
        title="以「步骤」（等待态边界）为单位查看顺序与分支"
        @click="emit('update:centerView', 'step')"
      >
        步骤
      </button>
    </div>

    <!-- 右：预览 + 动作溢出菜单 -->
    <div class="tb-group tb-right" @keydown="onToolMenuKeydown">
      <button class="preview-button btn-filled" @click="emit('preview')">
        ▶ 预览
      </button>
      <div ref="toolMenuAnchor" class="menu-anchor">
        <button
          class="icon-button"
          title="更多操作（保存 / 撤销 / 文件 / 工程）"
          aria-label="更多操作"
          :aria-expanded="toolMenuOpen"
          @click="toolMenuOpen = !toolMenuOpen"
        >
          ⋯
        </button>
        <div v-if="toolMenuOpen" class="menu" role="menu">
          <p class="menu-title">编辑</p>
          <button
            class="menu-item"
            role="menuitem"
            :disabled="!canSave"
            :title="saveTooltip"
            @click="
              emit('save');
              toolMenuOpen = false;
            "
          >
            {{ saving ? "保存中…" : "保存" }}<kbd>Ctrl+S</kbd>
          </button>
          <button
            class="menu-item"
            role="menuitem"
            :disabled="undoDepth === 0"
            @click="
              emit('undo');
              toolMenuOpen = false;
            "
          >
            撤销<span class="menu-hint">{{ undoDepth }} 步可回溯</span>
          </button>
          <button
            class="menu-item"
            role="menuitem"
            :disabled="redoDepth === 0"
            @click="
              emit('redo');
              toolMenuOpen = false;
            "
          >
            重做<span class="menu-hint">{{ redoDepth }} 步</span>
          </button>
          <p class="menu-sep" role="separator"></p>
          <p class="menu-title">工程与文件</p>
          <button
            class="menu-item"
            role="menuitem"
            @click="
              emit('import-json');
              toolMenuOpen = false;
            "
          >
            导入 JSON…
          </button>
          <button
            class="menu-item"
            role="menuitem"
            @click="
              emit('export');
              toolMenuOpen = false;
            "
          >
            导出工程
          </button>
          <button
            class="menu-item"
            role="menuitem"
            @click="
              emit('open-project');
              toolMenuOpen = false;
            "
          >
            打开工程…
          </button>
          <p class="menu-sep" role="separator"></p>
          <p class="menu-title">危险操作</p>
          <button
            class="menu-item btn-danger"
            role="menuitem"
            @click="
              emit('new');
              toolMenuOpen = false;
            "
          >
            新建工程（覆盖当前）
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
