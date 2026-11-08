<!--
  常驻提示条：一块贴在舞台上沿的只读小牌子。

  三条约定与宿主形态无关——自带 scoped 样式、不依赖 stage.css；只读部分设
  `pointer-events: none`，不吃舞台上的点击；不读引擎状态（显隐由 `mount` 决定，
  文案由 `props` 给，操作走 `controls`）。
-->
<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), { text: "" });
</script>

<template>
  <div v-if="text !== ''" class="hint" role="status">{{ text }}</div>
</template>

<style scoped>
.hint {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: rgb(0 0 0 / 55%);
  color: #f4f1e8;
  font-size: 0.875rem;
  pointer-events: none;
}
</style>
