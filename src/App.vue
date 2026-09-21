<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { parseStory, StoryEngine, SYS } from "./engine";

// —— 演示故事：单 flow 列 × 3 句 say（最小闭环数据）——
// 正式形态：故事经 project.json 清单 + Rust 侧加载（07/05）；此处内联仅为打通渲染链路
const story = parseStory({
  formatVersion: 1,
  id: "demo",
  columns: [
    {
      id: "start",
      kind: "flow",
      commands: [
        { op: "say", speaker: "灵泛", text: "你好，这里是灵泛新叙事引擎。" },
        { op: "say", text: "数据层 → 执行器 → 渲染，最小闭环已打通。" },
        { op: "say", speaker: "灵泛", text: "点击任意处推进对话。" },
      ],
    },
  ],
});

// —— 08-U1：核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
const speaker = ref("");
const text = ref("");
const canAdvance = ref(false);
const error = ref("");

const engine = new StoryEngine(story);
const offState = engine.onStateChanged(({ key, value }) => {
  if (key === SYS.currentDialogSpeaker && typeof value === "string")
    speaker.value = value;
  else if (key === SYS.currentDialogText && typeof value === "string")
    text.value = value;
  else if (key === SYS.waiting) canAdvance.value = value === "dialog";
});
const offEvent = engine.onEvent(({ payload }) => {
  error.value = `${payload.code}: ${payload.message}`;
});
engine.start();

/** 点击推进（Space/Enter 键位映射与打字机二段式随 08 实施） */
function advance(): void {
  engine.advance();
}

onUnmounted(() => {
  offState();
  offEvent();
});
</script>

<template>
  <main class="stage" @click="advance">
    <!-- RenderTargets.dialogue 挂载点（08 §一）；stage/choices/overlay/minigame 随对应规约落地 -->
    <section class="dialogue" aria-live="polite">
      <p v-if="speaker" class="speaker">{{ speaker }}</p>
      <p class="text">{{ text }}</p>
      <span v-if="canAdvance" class="advance-hint">▼</span>
    </section>
    <p v-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style scoped>
.stage {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 24px;
  cursor: pointer;
}

.dialogue {
  position: relative;
  min-height: 7em;
  padding: 16px 20px;
  border: 1px solid #4444;
  border-radius: 12px;
  background: #1e1e2ecc;
  color: #e6e6f0;
}

.speaker {
  margin: 0 0 8px;
  font-weight: 600;
  color: #7aa2f7;
}

.text {
  margin: 0;
  white-space: pre-wrap;
}

.advance-hint {
  position: absolute;
  right: 12px;
  bottom: 8px;
  color: #7aa2f7;
  animation: blink 1.2s infinite;
}

.error {
  margin: 8px 0 0;
  color: #f7768e;
  font-size: 12px;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
</style>
