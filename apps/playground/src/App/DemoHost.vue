<script setup lang="ts">
/**
 * 外部系统挂载容器：小游戏与外部玩法系统共用同一个元素。
 *
 * 容器不自建内容——内容由注册进宿主注册表的工厂构建，宿主在收尾回调里清空它并摘掉
 * 演示类标记。挂载与收尾都要元素句柄，故把元素引用暴露给宿主。
 */
import { ref } from "vue";

/** 挂载点元素（宿主经此挂载工厂内容） */
const minigameHostEl = ref<HTMLElement | null>(null);

defineExpose({ minigameHostEl });
</script>

<template>
  <div ref="minigameHostEl" class="minigame-host"></div>
</template>

<style scoped>
/** 小游戏宿主演示样式：骨架布局归宿主容器，计数与按钮的演示皮肤在 .minigame-demo 下。 */

/* 挂载容器：骨架归宿主（纵向排列、内容居中），内容归注册的工厂 */
.minigame-host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.minigame-demo .minigame-label {
  margin: 0;
  color: #a9b1d6;
  font-size: 0.9em;
}

.minigame-demo .minigame-count {
  font-size: 1.6em;
  font-variant-numeric: tabular-nums;
  color: #7aa2f7;
}

.minigame-demo button {
  padding: 8px 22px;
  font-size: 1em;
  border-radius: 8px;
  border: 1px solid #7aa2f755;
  background: #24283b;
  color: #c0caf5;
  cursor: pointer;
}

/* 外部玩法系统演示（WASD 行走）：容器由工厂接管，宿主只给这一层壳 */
.walk-demo {
  width: 100%;
  align-items: flex-start;
}

.walk-demo .walk-hint {
  margin: 0;
  color: #a9b1d6;
  font-size: 0.9em;
}

.walk-demo .walk-avatar {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(140deg, #7aa2f7, #bb9af7);
  box-shadow: 0 0 12px #7aa2f766;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .walk-demo .walk-avatar {
    transition: none;
  }
}
</style>
