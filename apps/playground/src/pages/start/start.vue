<script setup lang="ts">
/**
 * 启动页面：进游戏之前的普通界面，与引擎无关——它不订阅状态、不读引擎，
 * 只把「开始 / 继续」两个意图回抛宿主，由宿主决定何时让引擎跑起来。
 *
 * 没有存档时「继续」不可点：按钮 disabled 并给出提示，避免玩家点了没反应。
 */
withDefaults(
  defineProps<{
    /** 工程标题（组合根从 project.json 解析后注入） */
    title?: string;
    /** 可继续的槽位 id；空串 = 还没有存档，「继续」不可点 */
    resume?: string;
  }>(),
  { title: "", resume: "" },
);

const emit = defineEmits<{ start: []; continue: [slot: string] }>();
</script>

<template>
  <section class="start-page" data-page="start">
    <h1 class="start-page__title">{{ title }}</h1>
    <div class="start-page__actions">
      <button
        class="start-page__button start-page__button--primary"
        type="button"
        @click="emit('start')"
      >
        开始
      </button>
      <button
        class="start-page__button"
        type="button"
        :disabled="resume === ''"
        :title="resume === '' ? '还没有存档，先开始一局' : '从上次的进度继续'"
        @click="emit('continue', resume)"
      >
        继续
      </button>
    </div>
  </section>
</template>

<style scoped>
.start-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(16px, 4vh, 40px);
  box-sizing: border-box;
  padding: clamp(16px, 4vw, 48px);
  background: #0a0a10;
  color: #e6e6f0;
  font-size: 17px;
}
.start-page__title {
  margin: 0;
  font-size: clamp(24px, 4vw, 40px);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.start-page__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(100%, 320px);
}
.start-page__button {
  padding: 12px 20px;
  border: 1px solid rgb(230 230 240 / 22%);
  border-radius: 12px;
  background: rgb(30 30 46 / 88%);
  color: #e6e6f0;
  font-size: 16px;
  font-family: inherit;
  cursor: pointer;
}
.start-page__button:hover:not(:disabled) {
  border-color: #7aa2f7;
  color: #7aa2f7;
}
.start-page__button--primary {
  background: #7aa2f7;
  border-color: #7aa2f7;
  color: #0a0a10;
  font-weight: 600;
}
.start-page__button--primary:hover:not(:disabled) {
  background: #9ece6a;
  border-color: #9ece6a;
  color: #0a0a10;
}
.start-page__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
