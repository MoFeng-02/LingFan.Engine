<script setup lang="ts">
/**
 * 活动栏（最左窄条）：切**侧栏模式**的三个切面。
 *
 * 为何是「模式」而非三个平级面板：资源树 / 搜索 / 最近打开**共享同一份工程树**
 * （同一批 `ResourceNode`，只是过滤与排序不同）⇒ 拆成三个独立面板会逼出三份数据源，
 * 那是第二真源（本仓明令禁止的形态）。
 *
 * 无障碍：`role="tablist"` + `aria-selected`，键盘可达（原生 button）。
 */
import type { SidebarMode } from "../layout";

const props = defineProps<{
  mode: SidebarMode;
  /** 各模式下的条目数（角标）：让用户不切过去就知道那边有东西 */
  counts: { resources: number; search: number; recent: number };
}>();

const emit = defineEmits<{ (e: "update:mode", mode: SidebarMode): void }>();

/** 图标用 CSS 形状画（不引第三方图标库——E8 未裁，且这些形状够用） */
const ITEMS: readonly { mode: SidebarMode; label: string }[] = [
  { mode: "resources", label: "资源" },
  { mode: "search", label: "搜索" },
  { mode: "recent", label: "最近" },
];

function pick(mode: SidebarMode): void {
  if (mode !== props.mode) emit("update:mode", mode);
}
</script>

<template>
  <nav class="activity-bar" role="tablist" aria-label="侧栏模式">
    <button
      v-for="item in ITEMS"
      :key="item.mode"
      class="activity-item"
      :class="{ active: item.mode === mode }"
      role="tab"
      :aria-selected="item.mode === mode"
      :title="item.label"
      @click="pick(item.mode)"
    >
      <span class="activity-glyph" :data-mode="item.mode" aria-hidden="true"></span>
      <span class="activity-label">{{ item.label }}</span>
      <span
        v-if="counts[item.mode] > 0"
        class="activity-count"
        :aria-label="`${counts[item.mode]} 项`"
      >
        {{ counts[item.mode] > 99 ? "99+" : counts[item.mode] }}
      </span>
    </button>
  </nav>
</template>

<style scoped>
.activity-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 4px 2px;
  background: var(--lf-surface-sunken);
  border-right: 1px solid var(--lf-border-subtle);
  overflow: hidden;
}
.activity-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--lf-text-hint);
  cursor: pointer;
  position: relative;
}
.activity-item:hover {
  background: var(--lf-surface-overlay);
  color: var(--lf-text-secondary);
}
.activity-item.active {
  color: var(--lf-text-primary);
  background: var(--lf-surface-hover);
}
/* 选中指示条（活动栏左侧竖条，VS Code 式） */
.activity-item.active::before {
  content: "";
  position: absolute;
  left: -2px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--lf-accent);
}
.activity-glyph {
  width: 16px;
  height: 16px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.activity-glyph[data-mode="search"] {
  border-radius: 50%;
  border-width: 1.5px;
}
.activity-glyph[data-mode="recent"] {
  border-style: dashed;
}
.activity-label {
  font-size: var(--lf-font-xs);
  line-height: 1.2;
}
.activity-count {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  padding: 0 3px;
  font-size: var(--lf-font-xs);
  line-height: 14px;
  text-align: center;
  border-radius: 7px;
  background: var(--lf-border-subtle);
  color: var(--lf-text-secondary);
}
</style>
