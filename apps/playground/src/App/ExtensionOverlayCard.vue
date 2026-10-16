<script setup lang="ts">
/**
 * 扩展 op 等待覆盖层卡片：叙事暂停的「接管画面」，确认即解除。
 *
 * 展示态由宿主经 props 供给（挂载分支维护），解除权在宿主——卡片只回抛
 * confirm 事件；z 与对话层同面、靠 DOM 顺序盖在其上。
 */
import type { ExtensionOverlay } from "../host/mount";

const props = defineProps<{
  /** 当前扩展等待的展示态（父级 v-if 保证在场才渲染） */
  overlay: ExtensionOverlay;
  /** 层最终 z（与对话层同面） */
  zOf: (layer: "dialogue") => number;
}>();

const emit = defineEmits<{
  /** 玩家确认：宿主清覆盖层并回填扩展结果 */
  confirm: [];
}>();
</script>

<template>
  <div
    class="extension-overlay"
    :style="{ zIndex: zOf('dialogue') }"
    @click.stop
  >
    <div class="extension-card">
      <p class="extension-title">{{ props.overlay.title }}</p>
      <p v-if="props.overlay.detail !== ''" class="extension-detail">
        {{ props.overlay.detail }}
      </p>
      <p class="extension-hint">回溯 / 读档 / 导航会中断这次等待</p>
      <button
        type="button"
        class="extension-close"
        @click.stop="emit('confirm')"
      >
        确认
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 扩展 op 等待覆盖层：叙事暂停的「接管画面」，z 与对话层同面、靠 DOM 顺序盖在其上 */
.extension-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #12121aaa;
}

.extension-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 尺寸按舞台基准（1280 × 720）折算：舞台子树内不用视口单位——那些先按真实窗口解析，
     再被舞台缩放一次，等于随窗口二次变化，与「按基准像素书写」的口径冲突 */
  width: 420px;
  padding: 17px 28px;
  border-radius: 12px;
  background: #1c2136;
  border: 1px solid #3b4261;
  cursor: default;
}

.extension-card p {
  margin: 0;
}

.extension-title {
  font-weight: 600;
  font-size: 1.05em;
}

.extension-detail {
  color: #9ece6a;
}

.extension-hint {
  color: #565f89;
  font-size: 0.8em;
}

.extension-close {
  align-self: flex-end;
  padding: 8px 22px;
  border-radius: 8px;
  border: none;
  background: #3d59a1;
  color: #e6e6f0;
  font-size: 0.9em;
  cursor: pointer;
}
</style>
