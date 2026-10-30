<script setup lang="ts">
/**
 * UI 挂载层（Vue 形态）：把 `SYS.mounts` 里可见的 UI 铺成子组件。
 *
 * 三条边界：
 * 1. **值从哪来**：`mountStore` 由组合根喂（`bootHost` 的 `onMounts`），这里只订阅。
 *    自己再订阅一次引擎的话，退订就有两份实现，漏一份会在拆掉页面后继续写渲染树。
 * 2. **表从哪来**：`uis` 来自生成物（`src/gen/ui_register.g.ts`），键就是目录名，
 *    不做 `import.meta.glob`——那会把 `src/ui/` 下的文件全部静态拉进包。
 * 3. **隐藏 = 不渲染**：`v-for` 的集合就是可见集合，不可见的组件不在渲染树上，
 *    它的响应式与定时器随卸载一起停（不是 `display:none`）。
 *
 * 组件由 Vue 自己创建，所以挂载点的父子关系归 Vue——组合根不该再往这个容器里写节点。
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { missingMounts, selectMounts } from "@lingfan-engine/ui";
import { mountStore, uis } from "./mounts";

/** 当前 `SYS.mounts` 原始值：订阅前先读一次快照（订阅不回放历史） */
const raw = ref<unknown>(mountStore.snapshot());
const stop = mountStore.subscribe((next) => {
  raw.value = next;
});
onUnmounted(stop);

/** 这一帧该渲染的 UI：取不到组件的名字被跳过并单独上报 */
const items = computed(() => selectMounts(raw.value, uis));
const missing = computed(() => missingMounts(raw.value, uis));

// 生成物里没有的名字只报一次：按帧重渲染会把它刷成噪音，反而看不见真问题
const reported = new Set<string>();
watch(missing, (names) => {
  for (const name of names) {
    if (reported.has(name)) continue;
    reported.add(name);
    console.error(
      `[ui] 生成物 uis 里没有 ${name}，这条挂载被跳过——构建期本应拦住越界的 UI 名`,
    );
  }
});
</script>

<template>
  <component
    :is="item.component"
    v-for="item in items"
    :key="item.name"
    v-bind="item.props"
  />
</template>
