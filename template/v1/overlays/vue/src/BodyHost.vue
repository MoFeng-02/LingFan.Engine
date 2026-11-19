<script setup lang="ts">
/**
 * 列身体层（Vue 形态）：把当前列的身体组件渲染成这一屏。
 *
 * 与 `UiHost` 的分工：挂载层是「叠加在列上的多个 UI」，身体层是「这一列自己的屏」，
 * 一列只有一个身体。两条边界与挂载层同口径：
 * 1. **值从哪来**：`bodyStore` 由组合根喂（`bootHost` 的 `onBody`），这里只订阅。
 *    自己再订阅一次引擎的话，退订就有两份实现，漏一份会在拆掉页面后继续写渲染树。
 * 2. **选择已在展示层做完**：`createBodyLayer` 已按 `SYS.body.name` 查表、注入 `env`、
 *    把查不到的名字走诊断出口——这里拿到的就是要渲染的视图，不再自己查表、不再自报缺名。
 *
 * 用 `shallowRef`：视图里带着组件对象与 `env`（含函数），深度响应式会把它们包成代理，
 * 既无必要又可能改写组件身份。身体是「整份换」的，浅层引用足够触发重渲染。
 */
import { onUnmounted, shallowRef } from "vue";
import type { BodyView } from "@lingfan-engine/ui";
import { bodyStore } from "./scenes";

/** 当前身体视图：订阅前先读一次快照（订阅不回放历史）；`null` = 这一列没有身体 */
const view = shallowRef<BodyView | null>(bodyStore.snapshot());
const stop = bodyStore.subscribe((next) => {
  view.value = next;
});
onUnmounted(stop);
</script>

<template>
  <!-- 同名更新不重挂（`:key` 是名字）：组件内部状态在原地保留；换名才整份换身体 -->
  <component
    :is="view.component"
    v-if="view"
    :key="view.name"
    v-bind="view.props"
  />
</template>
