<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { Story, ValueChanged } from "@lingfan/engine";
import { SYS, StoryEngine, type OutboundPayload } from "@lingfan/engine";
import {
  builtinBubbleTemplate,
  createDialogueTemplateRegistry,
  renderDialogueLine,
  Typewriter,
  type DialogueTemplateView,
} from "@lingfan/ui";

/**
 * 06 §一.1 预览视图：当前故事快照跑真引擎（无端口——音频/视频键不观察即静音，
 * I18N/存档缺省）。预览为打开时刻的快照运行，编辑不实时渗入。
 * 打字机（08-U3）：单句对话层 Typewriter + rAF 帧驱动；NVL 累积层即时显示
 * （增量渲染优化随 playground 级打磨，预览规模不需要）。
 */
const props = defineProps<{ story: Story }>();
const emit = defineEmits<{ close: [] }>();

// 预览不接小游戏注册表：挂载事件按 D5 fail-closed 显示横幅（不伪造完成）
const engine = new StoryEngine(props.story);
const column = ref("");
const dialogText = ref("");
const speaker = ref("");
const templateName = ref<string | null>("");
const menuPrompt = ref("");
const menuChoices = ref<Array<{ text: string; target: string }>>([]);
const inputPrompt = ref("");
const inputValue = ref("");
const waiting = ref<string>("none");
const nvlMode = ref("none");
const nvlBuffer = ref<string[]>([]);
const toasts = ref<Array<{ id: number; text: string }>>([]);
const errorText = ref("");
const minigameBanner = ref("");
let notifySeq = 0;
let toastTimer = 0;

const dialogueTemplates = createDialogueTemplateRegistry();
dialogueTemplates.register("bubble", builtinBubbleTemplate, {
  makeDefault: true,
});

const canAdvance = computed(() => waiting.value === "dialog");

const dialogView = computed<DialogueTemplateView>(() => {
  const template =
    dialogueTemplates.resolve(templateName.value) ?? builtinBubbleTemplate;
  return template({
    speaker: speaker.value,
    speakerColor: "",
    lineHtml: renderDialogueLine({ text: shownText.value }).html,
    canAdvance: canAdvance.value,
  });
});

const nvlHtmlLines = computed(() =>
  nvlBuffer.value.map((line) => renderDialogueLine({ text: line }).html),
);

// —— 08-U3 打字机：单句对话层（rAF 帧驱动；NVL 即时显示） ——
const shownText = ref("");
let typewriter: Typewriter | null = null;
let rafId = 0;
let lastTs = 0;

function frame(ts: number): void {
  const tw = typewriter;
  if (tw !== null) {
    if (lastTs !== 0 && !tw.done) tw.tick((ts - lastTs) / 1000);
    lastTs = ts;
    shownText.value = tw.visible;
  } else {
    lastTs = 0;
  }
  rafId = window.requestAnimationFrame(frame);
}
rafId = window.requestAnimationFrame(frame);

function retype(text: string): void {
  typewriter = new Typewriter(text, 30); // 预览固定 30 cps（完整偏好链随 playground 装配）
  shownText.value = typewriter.visible;
}

function syncMenu(): void {
  const options = (engine.get(SYS.menuOptions) as string[] | undefined) ?? [];
  const targets = (engine.get(SYS.menuTargets) as string[] | undefined) ?? [];
  menuChoices.value = options.map((text, i) => ({
    text,
    target: targets[i] ?? "",
  }));
}

const offState = engine.onStateChanged((c: ValueChanged) => {
  if (c.key === SYS.currentDialogText) {
    dialogText.value = String(c.value ?? "");
    retype(dialogText.value);
  } else if (c.key === SYS.currentDialogSpeaker)
    speaker.value = String(c.value ?? "");
  else if (c.key === SYS.dialogTemplate)
    templateName.value = c.value as string | null;
  else if (c.key === SYS.menuPrompt) menuPrompt.value = String(c.value ?? "");
  else if (c.key === SYS.menuOptions || c.key === SYS.menuTargets)
    syncMenu(); // 两键分别派发：以最后写入的键为准做完整同步（避免读旧 targets）
  else if (c.key === SYS.inputPrompt) inputPrompt.value = String(c.value ?? "");
  else if (c.key === SYS.waiting) waiting.value = String(c.value ?? "none");
  else if (c.key === SYS.nvlMode) nvlMode.value = String(c.value ?? "none");
  else if (c.key === SYS.nvlBuffer)
    nvlBuffer.value = (c.value as string[] | undefined) ?? [];
  else if (c.key === SYS.currentSceneColumn)
    column.value = String(c.value ?? "");
});

const offEvent = engine.onEvent((event) => {
  const payload: OutboundPayload = event.payload;
  if (payload.kind === "notify") {
    const id = ++notifySeq;
    toasts.value.push({ id, text: payload.text });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2600);
  } else if (payload.kind === "engine.error") {
    errorText.value = `[${payload.code}] ${payload.message}`;
  } else if (payload.kind === "minigame.mount") {
    minigameBanner.value = `小游戏未注册：${payload.game}（编辑器预览不带注册表——D5 fail-closed，不伪造完成）`;
  }
});

engine.start();

function onStageClick(): void {
  if (errorText.value !== "") return;
  if (waiting.value !== "dialog") return;
  // 08-U3 二段式点击：停在 {p}/{w} → 越过；打字未完 → 瞬间完成；已完 → advance
  if (typewriter !== null && !typewriter.done) {
    typewriter.click();
    shownText.value = typewriter.visible;
    return;
  }
  engine.advance();
}

function choose(target: string): void {
  engine.choose(target);
}

function submitInput(): void {
  const value = inputValue.value.trim();
  if (value === "") return;
  engine.input(value);
  inputValue.value = "";
}

function finishVideo(): void {
  engine.videoFinished(); // 预览不含媒体渲染：手动模拟视频结束以继续剧情
}

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer);
  window.cancelAnimationFrame(rafId);
  offState();
  offEvent();
  engine.dispose();
});
</script>

<template>
  <div class="preview-overlay">
    <header class="preview-bar">
      <strong>预览</strong>
      <span class="preview-column">{{ column }}</span>
      <span class="preview-note">打开时刻的快照 · 音视频静音</span>
      <span class="spacer"></span>
      <button @click="emit('close')">退出预览</button>
    </header>

    <div class="preview-stage" @click="onStageClick">
      <p v-if="errorText !== ''" class="preview-error">{{ errorText }}</p>
      <p v-if="minigameBanner !== ''" class="preview-banner">
        {{ minigameBanner }}
      </p>

      <!-- NVL 累积层 -->
      <div v-if="nvlMode !== 'none' && nvlBuffer.length > 0" class="nvl-layer">
        <p v-for="(line, i) in nvlHtmlLines" :key="i" v-html="line"></p>
      </div>

      <!-- 对话（模板视图契约：骨架固定三挂点 + 皮肤类） -->
      <div
        v-if="nvlMode === 'none' && waiting === 'dialog'"
        class="dialogue"
        :class="dialogView.rootClass"
      >
        <div class="speaker" v-html="dialogView.speakerHtml"></div>
        <div class="body" v-html="dialogView.bodyHtml"></div>
        <div class="hint" v-html="dialogView.hintHtml"></div>
      </div>

      <!-- 等待/输入/视频/小游戏横幅 -->
      <p v-if="waiting === 'wait'" class="waiting-note">等待中…（点击跳过）</p>
      <div v-if="waiting === 'input'" class="choices" @click.stop>
        <p class="layer-prompt">{{ inputPrompt }}</p>
        <form class="input-row" @submit.stop.prevent="submitInput">
          <input v-model="inputValue" type="text" maxlength="20" @click.stop />
          <button type="submit">确定</button>
        </form>
      </div>
      <div v-if="waiting === 'menu'" class="choices" @click.stop>
        <p class="layer-prompt">{{ menuPrompt }}</p>
        <button
          v-for="choice in menuChoices"
          :key="choice.target"
          class="choice"
          @click="choose(choice.target)"
        >
          {{ choice.text }}
        </button>
      </div>
      <div v-if="waiting === 'video'" class="choices" @click.stop>
        <p class="layer-prompt">视频播放中（预览不含媒体）</p>
        <button @click="finishVideo">模拟视频结束</button>
      </div>
      <div v-if="waiting === 'minigame'" class="choices" @click.stop>
        <p class="layer-prompt">{{ minigameBanner }}</p>
        <button @click="emit('close')">退出预览</button>
      </div>

      <!-- 通知 toast -->
      <div class="toasts">
        <p v-for="toast in toasts" :key="toast.id" class="toast">
          {{ toast.text }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  background: #0b0b10ee;
  z-index: 50;
  display: flex;
  flex-direction: column;
}
.preview-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #16161e;
  border-bottom: 1px solid #24283b;
}
.preview-column {
  color: #7aa2f7;
  font-family: Consolas, monospace;
  font-size: 12px;
}
.preview-note {
  color: #565f89;
  font-size: 11px;
}
.spacer {
  flex: 1;
}
.preview-stage {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 24px;
  cursor: pointer;
  overflow: auto;
}
.preview-error {
  color: #f7768e;
  border: 1px solid #f7768e88;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 0 0 12px;
}
.preview-banner {
  color: #e0af68;
  border: 1px solid #e0af6888;
  border-radius: 6px;
  padding: 8px 12px;
  margin: 0 0 12px;
}
.nvl-layer {
  background: #101014d9;
  border: 1px solid #24283b;
  border-radius: 8px;
  padding: 14px 18px;
  margin-bottom: 12px;
  max-height: 50%;
  overflow: auto;
}
.nvl-layer p {
  margin: 4px 0;
  color: #c0caf5;
}
.dialogue {
  background: #16161ecc;
  border: 1px solid #3b4261;
  border-radius: 10px;
  padding: 12px 18px;
  min-height: 96px;
}
.speaker {
  color: #7aa2f7;
  font-weight: 600;
  margin-bottom: 4px;
}
.body {
  color: #c0caf5;
  line-height: 1.6;
}
.hint {
  text-align: right;
  color: #565f89;
  font-size: 11px;
}
.waiting-note {
  color: #565f89;
  font-style: italic;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  max-width: 420px;
}
.layer-prompt {
  color: #9aa5ce;
  margin: 0 0 4px;
}
.choice {
  text-align: left;
  padding: 8px 14px;
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row input {
  flex: 1;
}
.toasts {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.toast {
  background: #24283bee;
  border: 1px solid #7aa2f755;
  border-radius: 6px;
  padding: 6px 12px;
  margin: 0;
  color: #c0caf5;
  font-size: 12px;
}
</style>
