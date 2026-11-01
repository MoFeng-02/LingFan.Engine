<script setup lang="ts">
/**
 * 暂停菜单：对局中唤出的普通界面，铺满视口接管点击——舞台仍在下面挂着，
 * 只是收不到输入（引擎侧已暂停，推进命令会被拒）。
 *
 * 组件不碰引擎：四个动作全部回抛宿主，由宿主经操作通道转给引擎。
 */
withDefaults(
  defineProps<{
    /** 工程标题（与启动页同源） */
    title?: string;
    /** 是否有可读的存档；false 时「读取」不可点 */
    canLoad?: boolean;
    /** 可写存档的槽位 id；空串时「保存」不可点 */
    saveSlot?: string;
  }>(),
  { title: "", canLoad: false, saveSlot: "" },
);

const emit = defineEmits<{
  resume: [];
  save: [slot: string];
  load: [slot: string];
  home: [];
}>();
</script>

<template>
  <section class="pause-page" data-page="pause" @click.stop>
    <h2 class="pause-page__title">{{ title === "" ? "已暂停" : title }}</h2>
    <p class="pause-page__hint">按 Esc 也可以回到游戏</p>
    <div class="pause-page__actions">
      <button class="pause-page__button" type="button" @click="emit('resume')">
        继续游戏
      </button>
      <button
        class="pause-page__button"
        type="button"
        :disabled="saveSlot === ''"
        @click="emit('save', saveSlot)"
      >
        保存进度
      </button>
      <button
        class="pause-page__button"
        type="button"
        :disabled="!canLoad || saveSlot === ''"
        :title="canLoad ? '读取最近的存档' : '还没有存档'"
        @click="emit('load', saveSlot)"
      >
        读取存档
      </button>
      <button class="pause-page__button" type="button" @click="emit('home')">
        回到标题
      </button>
    </div>
  </section>
</template>

<style scoped>
.pause-page {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(10px, 2vh, 20px);
  box-sizing: border-box;
  padding: clamp(16px, 4vw, 48px);
  background: rgb(10 10 16 / 82%);
  color: #e6e6f0;
  font-size: 17px;
  pointer-events: auto;
}
.pause-page__title {
  margin: 0;
  font-size: clamp(20px, 3vw, 30px);
  font-weight: 600;
}
.pause-page__hint {
  margin: 0;
  color: #a9b1d6;
  font-size: 13px;
}
.pause-page__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(100%, 300px);
}
.pause-page__button {
  padding: 11px 18px;
  border: 1px solid rgb(230 230 240 / 22%);
  border-radius: 12px;
  background: rgb(30 30 46 / 88%);
  color: #e6e6f0;
  font-size: 16px;
  font-family: inherit;
  cursor: pointer;
}
.pause-page__button:hover:not(:disabled) {
  border-color: #7aa2f7;
  color: #7aa2f7;
}
.pause-page__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
