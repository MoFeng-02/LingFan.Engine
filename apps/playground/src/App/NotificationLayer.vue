<script setup lang="ts">
/**
 * 通知层：RenderTargets.overlay 的 toast 列表。
 *
 * 列表状态由宿主供给（@lingfan/shell 的提示条编排维护），模板产出皮肤类与
 * 正文挂点（HTML 已由模板层消毒）；条目皮肤样式随本组件走。
 */
import type { Notice } from "@lingfan/shell";
import type { NotifyTemplateView } from "@lingfan/ui";

defineProps<{
  /** 当前在场的提示条（尾部追加、到期摘除） */
  notices: Notice[];
  /** 模板投影：文本与基调 → 皮肤类与正文挂点 */
  notifyViewOf: (text: string, tone: Notice["tone"]) => NotifyTemplateView;
  /** 层最终 z */
  zOf: (layer: "notifications") => number;
}>();
</script>

<template>
  <!-- RenderTargets.overlay（notify toast）：模板骨架 = 通知项 + 正文挂点 -->
  <ul class="notifications" :style="{ zIndex: zOf('notifications') }">
    <li
      v-for="n in notices"
      :key="n.id"
      :class="notifyViewOf(n.text, n.tone).rootClass"
      v-html="notifyViewOf(n.text, n.tone).bodyHtml"
    ></li>
  </ul>
</template>

<style scoped>
.notifications {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  right: calc(16px + env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.notifications li {
  padding: 8px 14px;
  border-radius: 8px;
  background: #2a2f45dd;
  color: #9ece6a;
  font-size: 0.85em;
}

/* 通知层模板皮肤：按 tone 换色（骨架固定，仅正文挂点与皮肤类由模板产出） */
.notifications li.tpl-notify-warning {
  color: #e0af68;
}

.notifications li.tpl-notify-error {
  color: #f7768e;
}
</style>
