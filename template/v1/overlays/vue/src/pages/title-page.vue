<script setup lang="ts">
/**
 * 标题界面（Vue 形态示范）：用整屏页面渲染 `ui` 列，与骨架的原生版逐条对等。
 *
 * 两条边界在这一层同样成立，只是写法换了：
 * 1. **只读经 `StateReader`、只写经命令面**——页面不碰状态键，也不自己造存档格式；
 * 2. **离开即真销毁**——组合根的 `unmount` 调 `app.unmount()`，Vue 的响应式与
 *    事件监听随实例一起拆掉。所以这里不把跨次状态放模块级变量：那些状态该进
 *    `gameState`（随存档/回溯随行）。
 *
 * 页面不认识「这是标题页」这件事——它只是被注册在某个列 id 上，引擎进了那一列就挂它。
 */
import { computed } from "vue";
import type { PageContext } from "../host";

const props = defineProps<{ ctx: PageContext }>();

/** 当前所在列 id：读口给的，缺省空串（= 还没有位置） */
const at = computed(() => props.ctx.reader.currentColumnId());

/** 开始游戏：按列名跳转，页面不需要知道目标列是 JSON 还是 TS 写出来的 */
function start(): void {
  props.ctx.engine.navigate("chapter1");
}

/** 继续：读引擎的自动存档槽；无档时只出一条错误事件，不抛 */
function resume(): void {
  props.ctx.engine.load("auto");
}
</script>

<template>
  <section class="page-title">
    <h1 class="page-title__heading">__PROJECT__</h1>
    <p class="page-title__subtitle">
      这一屏是 Vue 渲染的页面，不是 op 堆出来的
    </p>
    <p class="page-title__progress">
      {{ at === "" ? "尚无当前界面" : `当前界面：${at}` }}
    </p>
    <div class="page-title__actions">
      <button class="page-title__start" type="button" @click="start">
        开始游戏
      </button>
      <button class="page-title__continue" type="button" @click="resume">
        继续
      </button>
    </div>
  </section>
</template>
