<!--
  启动界面（Vue 形态）：进游戏前盖住舞台的整屏界面。

  三条边界：

  1. **不是引擎概念**。引擎只知道自己停在哪一列、那一列是什么类型；「该不该画这一屏」
     由 `screenStore` 的屏幕态决定（列 id 为空串或列类型不是 `game` 都算启动界面）。
  2. **舞台不卸载**。舞台节点在装配期就被 `must()` 抓住，卸载再挂回等于换一批新节点，
     宿主手上的句柄全部失效。这里用 `v-if` 真挂载/真卸载的只有本组件自己，舞台留在
     原地并被 `inert` + `aria-hidden` 让位（见骨架 `src/host/switch.ts`）。
  3. **只画，不做判断**。标题、槽位、能不能继续全来自屏幕态；开始与继续各自调一个
     回调，导航到哪一列由宿主翻。
-->
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { screenStore } from "./screen";

const view = ref(screenStore.snapshot());
const stop = screenStore.subscribe((next) => {
  view.value = next;
});
onUnmounted(stop);

/**
 * 待渲染的内容；不在启动界面时为 `null`。
 *
 * 在这里一次性收窄，模板里就不用反复判空——也能让「可继续」的槽位是一个
 * 非空的字符串，模板不必再处理 `undefined`。
 */
const shown = computed(() => {
  const current = view.value;
  if (current === undefined || current.screen !== "start") return null;
  const slot = current.resume.slot;
  return {
    title: current.title,
    reason: current.resume.reason,
    resumable: slot !== undefined,
    resume: () => {
      if (slot !== undefined) current.load(slot);
    },
    start: () => {
      current.start();
    },
  };
});
</script>
<template>
  <!-- 点击不外传：舞台根的点击是「推进对话」，落到这里会顺带跳一句 -->
  <div v-if="shown !== null" class="screen-start" @click.stop>
    <div class="screen-start__body">
      <h1 class="screen-start__heading">{{ shown.title }}</h1>
      <p class="screen-start__subtitle">
        点开始进入故事；有存档时可从中断处继续。
      </p>
      <div class="screen-start__actions">
        <button
          class="screen-start__button"
          type="button"
          :disabled="!shown.resumable"
          :title="shown.reason"
          @click="shown.resume()"
        >
          继续
        </button>
        <button
          class="screen-start__button"
          type="button"
          @click="shown.start()"
        >
          开始
        </button>
      </div>
    </div>
  </div>
</template>
