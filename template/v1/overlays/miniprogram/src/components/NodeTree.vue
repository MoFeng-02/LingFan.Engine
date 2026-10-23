<script setup lang="ts">
/**
 * 递归节点树：把 `mp/view.ts` 算出的描述树铺成节点。
 *
 * 小程序没有 DOM，渲染就是「数据 + 模板」：这一层只做映射，不拼样式（行内样式串已在数据侧
 * 算好）。组件自带样式——小程序组件默认样式隔离，页面样式不会穿透进来。自引用靠文件名。
 */
import type { MiniNode } from "../mp/view.ts";

defineProps<{ nodes: MiniNode[] }>();
</script>

<template>
  <template v-for="node in nodes" :key="node.key">
    <image
      v-if="node.kind === 'image'"
      class="node node-image"
      :class="node.className"
      :style="node.style"
      :src="node.src"
      mode="widthFix"
    />
    <view
      v-else
      class="node"
      :class="[`node-${node.kind}`, node.className]"
      :style="node.style"
    >
      <text v-if="node.text">{{ node.text }}</text>
      <rich-text v-else-if="node.html" :nodes="node.html" />
      <NodeTree v-if="node.children" :nodes="node.children" />
    </view>
  </template>
</template>

<style>
.node {
  position: absolute;
}

.node-image {
  display: block;
}
</style>
