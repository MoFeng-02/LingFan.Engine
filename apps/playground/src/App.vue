<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  SYS,
  StoryEngine,
  type AudioPort,
  type ResourcePort,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import {
  Typewriter,
  createAudioRenderer,
  createVideoRenderer,
  renderDialogueLine,
  type AudioRenderer,
  type VideoRenderer,
} from "@lingfan/ui";

// —— 08-U1：核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
// 工程与平台端口都由组合根（main.ts）装配注入：本组件只消费契约，不知道任何具体实现
const props = defineProps<{
  story: Story;
  savePort: SavePort;
  resourcePort: ResourcePort;
  /** 端口工厂而非实例：restart 重建音频/视频通道时保持「选择权在组合根」 */
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}>();

const speaker = ref("");
const text = ref("");
const canAdvance = ref(false);
const inMenu = ref(false);
const inWait = ref(false);
const inInput = ref(false);
const inVideo = ref(false);
const menuPrompt = ref("");
const inputPrompt = ref("");
const inputValue = ref("");
const error = ref("");
const rawTexts = ref<string[]>([]);
const rawTargets = ref<string[]>([]);
const menuOptions = computed(() =>
  rawTexts.value.map((t, i) => ({
    text: t,
    target: rawTargets.value[i] ?? "",
  })),
);
const notifications = ref<Array<{ id: number; text: string }>>([]);
let notifySeq = 0;
// —— 08-U3 打字机 / U5 NVL / §四 历史面板 / U4 角色样式 ——
const shownText = ref(""); // 打字机可见前缀（渲染层 v-html）
const speakerColor = ref(""); // U4：角色样式自动应用
const nvlMode = ref("none");
const nvlBuffer = ref<string[]>([]);
// —— 08 §五 NVL 累积层：已打完的行 memo 一次（O(新增)——老引擎 B1/C4 缺陷①教训：
// 静态行若随打字帧全量重渲染即 O(全文) 每帧），最新一行走打字机（统一渲染接缝）——
const nvlPastLines = computed(() =>
  nvlBuffer.value
    .slice(0, -1)
    .map((line) => renderDialogueLine({ text: line }).html),
);
const nvlTypingLine = computed(() => nvlBuffer.value.at(-1) ?? "");
const nvlBody = ref<HTMLElement | null>(null);
watch(nvlBuffer, () => {
  void nextTick(() => {
    const body = nvlBody.value;
    if (body !== null) body.scrollTop = body.scrollHeight; // 累积层贴底（阅读最新句）
  });
});
const showHistory = ref(false);
const historyEntries = ref<
  Array<{
    index: number;
    speaker: string;
    text: string;
    nvl: boolean;
    nvlLines: string[];
  }>
>([]);

/** 08 §四 历史呈现（NVL × 历史搭配裁定）：**连续 NVL 条目聚合为一个块**——
 * 玩家所见本来就是整块累积画面，块级回溯 = 回到「块尾检查点」（整块可见的时刻，
 * 03-R1 语义的自然延伸）；buffer 收缩（nvl clear）即分段。回溯粒度不减：
 * 逐检查点仍全在 history 里，只是呈现聚合。 */
interface HistoryBlock {
  key: string; // 块首条目 index（稳定，避免 Vue 重建）
  index: number; // 回溯目标 = 块尾检查点
  speaker: string;
  lines: string[];
  nvl: boolean;
}
const historyBlocks = computed<HistoryBlock[]>(() => {
  const blocks: HistoryBlock[] = [];
  for (const entry of historyEntries.value) {
    const prev = blocks.at(-1);
    if (
      entry.nvl &&
      prev?.nvl === true &&
      entry.nvlLines.length >= prev.lines.length
    ) {
      prev.index = entry.index; // 同段延续：块尾推进为最新检查点
      prev.lines = entry.nvlLines;
      continue;
    }
    blocks.push({
      key: `blk-${entry.index}`,
      index: entry.index,
      speaker: entry.speaker,
      lines: entry.nvl ? [...entry.nvlLines] : [entry.text],
      nvl: entry.nvl,
    });
  }
  return blocks;
});
let typewriter: Typewriter | null = null;
let rafId = 0;
let lastFrame = 0;
let engine: StoryEngine;
let offState: (() => void) | undefined;
let offEvent: (() => void) | undefined;
// —— 08 §六 音频：端口由组合根注入（本组件只见契约）；渲染器做状态差量 ——
function reportAudioError(message: string): void {
  error.value = message;
}
let audioPort: AudioPort = props.createAudioPort(reportAudioError);
let audioRenderer: AudioRenderer | null = null;
let videoPort: VideoPort = props.createVideoPort(reportAudioError);
let videoRenderer: VideoRenderer | null = null;

function createRenderer(): AudioRenderer {
  return createAudioRenderer(engine, audioPort, props.resourcePort, {
    onError: reportAudioError,
  });
}

function createVideo(): VideoRenderer {
  return createVideoRenderer(engine, videoPort, props.resourcePort, {
    onError: reportAudioError,
    onVideoFinished: () => engine.videoFinished(), // 组合根职责：播完 → 引擎命令
  });
}

function tickLoop(now: number): void {
  const dt = lastFrame > 0 ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  typewriter?.tick(dt);
  shownText.value = typewriter?.visible ?? text.value;
  audioRenderer?.pollPosition(); // 08 §三.2：媒体位置帧级回写
  rafId = requestAnimationFrame(tickLoop);
}

function handleState({ key, value }: { key: string; value: unknown }): void {
  if (key === SYS.currentDialogSpeaker && typeof value === "string") {
    speaker.value = value;
    // 08-U4：角色样式自动应用——查注册表取 speaker 色
    const def = engine.getCharacter(value);
    speakerColor.value = def?.color ?? "";
  } else if (key === SYS.currentDialogText && typeof value === "string") {
    text.value = value;
    typewriter = new Typewriter(value, 30); // 每句重建打字机（30 字/秒）
  } else if (key === SYS.waiting) {
    canAdvance.value = value === "dialog";
    inMenu.value = value === "menu";
    inWait.value = value === "wait";
    inInput.value = value === "input";
    inVideo.value = value === "video"; // 08 §六.5：cutscene 等待（点击/空格 = 跳过）
  } else if (key === SYS.menuPrompt && typeof value === "string")
    menuPrompt.value = value;
  else if (key === SYS.inputPrompt && typeof value === "string")
    inputPrompt.value = value;
  else if (key === SYS.menuOptions && Array.isArray(value))
    rawTexts.value = value as string[];
  else if (key === SYS.menuTargets && Array.isArray(value))
    rawTargets.value = value as string[];
  // 08 §五 NVL 系统键（用户实测回归：前进播放时 NVL 累积不显示——
  // 此前只有回溯/读档的 syncFromEngine 才同步这两个键）
  else if (key === SYS.nvlMode && typeof value === "string")
    nvlMode.value = value;
  else if (key === SYS.nvlBuffer && Array.isArray(value))
    nvlBuffer.value = value;
}

function syncFromEngine(): void {
  // 03-R4 / 05 / 08-U5：回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话与 NVL 系统键）
  const sp = engine.get(SYS.currentDialogSpeaker);
  const tx = engine.get(SYS.currentDialogText);
  speaker.value = typeof sp === "string" ? sp : "";
  text.value = typeof tx === "string" ? tx : "";
  const w = engine.get(SYS.waiting);
  canAdvance.value = w === "dialog";
  inMenu.value = w === "menu";
  inWait.value = w === "wait";
  inInput.value = w === "input";
  const mp = engine.get(SYS.menuPrompt);
  menuPrompt.value = typeof mp === "string" ? mp : "";
  const ip = engine.get(SYS.inputPrompt);
  inputPrompt.value = typeof ip === "string" ? ip : "";
  const opts = engine.get(SYS.menuOptions);
  rawTexts.value = Array.isArray(opts) ? (opts as string[]) : [];
  const tgts = engine.get(SYS.menuTargets);
  rawTargets.value = Array.isArray(tgts) ? (tgts as string[]) : [];
  const nm = engine.get(SYS.nvlMode);
  nvlMode.value = typeof nm === "string" ? nm : "none";
  const nb = engine.get(SYS.nvlBuffer);
  nvlBuffer.value = Array.isArray(nb) ? (nb as string[]) : [];
  // U4：说话人色随恢复同步
  const def = engine.getCharacter(speaker.value);
  speakerColor.value = def?.color ?? "";
  // 打字机随恢复文本重建
  typewriter = new Typewriter(text.value, 30);
}

function handleEvent({
  payload,
}: {
  payload: import("@lingfan/engine").OutboundPayload;
}): void {
  if (payload.kind === "notify") {
    const id = ++notifySeq;
    notifications.value.push({ id, text: payload.text });
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== id);
    }, payload.duration ?? 3000);
  } else if (payload.kind === "rollback.done") {
    error.value = "";
    syncFromEngine(); // 03-R4：回放完成解除输入锁并同步渲染
    audioRenderer?.sync(); // 03-R7：媒体位置随快照恢复（回滚 seek）
    videoRenderer?.sync(); // 08 §六.5：视频命令流对齐（回溯到段内 = 重播）
    const id = ++notifySeq;
    notifications.value.push({ id, text: "已回溯" });
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== id);
    }, 1500);
  } else {
    error.value = `${payload.code}: ${payload.message}`;
  }
}

function bindEngine(e: StoryEngine): void {
  offState = e.onStateChanged(handleState);
  offEvent = e.onEvent(handleEvent);
}

/**
 * fail-closed 停机（引擎报错后拒绝继续）的恢复入口：整体重建引擎。
 * 正式形态由命令面承担（读档/回标题，03/05）；演示层先给最简重开。
 */
function restart(): void {
  offState?.();
  offEvent?.();
  // 停播并释放播放器，再释放已解析 URL（顺序：先停播后回收，Blob 场景才安全）
  audioPort.dispose();
  audioRenderer?.dispose();
  audioPort = props.createAudioPort(reportAudioError);
  videoPort.dispose();
  videoRenderer?.dispose();
  videoPort = props.createVideoPort(reportAudioError);
  engine.dispose();
  engine = new StoryEngine(props.story);
  bindEngine(engine);
  audioRenderer = createRenderer();
  videoRenderer = createVideo();
  speaker.value = "";
  text.value = "";
  shownText.value = "";
  canAdvance.value = false;
  inMenu.value = false;
  inWait.value = false;
  inInput.value = false;
  inVideo.value = false;
  menuPrompt.value = "";
  inputPrompt.value = "";
  inputValue.value = "";
  error.value = "";
  rawTexts.value = [];
  rawTargets.value = [];
  nvlMode.value = "none";
  nvlBuffer.value = [];
  typewriter = null;
  engine.start();
}

engine = new StoryEngine(props.story);
bindEngine(engine);
audioRenderer = createRenderer();
videoRenderer = createVideo();
engine.start();

// —— 08-U3：rAF 帧循环驱动打字机（08 §三.1）——
rafId = requestAnimationFrame(tickLoop);

// —— 08 §七 键位映射：Space/Enter=推进（语义归核心层），H=历史面板 ——
function onKeydown(e: KeyboardEvent): void {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    onStageClick();
  } else if (e.key === "h" || e.key === "H") {
    toggleHistory();
  }
}
window.addEventListener("keydown", onKeydown);

// —— 05 存档：TS 编排 + SavePort 适配器（Tauri=K7 Rust 安全；浏览器演示=localStorage 兜底）——
const savePort = props.savePort;

function toast(text: string, duration = 1500): void {
  const id = ++notifySeq;
  notifications.value.push({ id, text });
  setTimeout(() => {
    notifications.value = notifications.value.filter((n) => n.id !== id);
  }, duration);
}

async function saveGame(): Promise<void> {
  const data = engine.exportSave();
  if (data === null) return; // fail-closed：不在等待点，错误已出站
  try {
    await savePort.write("slot_1", JSON.stringify(data), "machine-bound");
    toast("已保存到槽位 1");
  } catch (e) {
    error.value = `保存失败：${String(e)}`;
  }
}

async function loadGame(): Promise<void> {
  try {
    const payload = await savePort.read("slot_1");
    const ok = engine.importSave(
      JSON.parse(payload) as import("@lingfan/engine").SaveDataV1,
    );
    if (!ok) return; // 引擎已拒绝（fail-closed），错误横幅已出站——不得清空、不得报成功
    error.value = "";
    syncFromEngine();
    audioRenderer?.sync(); // 05 §四：读档恢复媒体状态（bgm 曲目 + 播放位置）
    videoRenderer?.sync();
    toast("已读取槽位 1（回到存档时刻）", 2500);
  } catch (e) {
    error.value = `读取失败：${String(e)}`;
  }
}

/** 08-U3/U8：打字机二段式点击（未完成=瞬间完成/越过停顿，完成=advance）；仅在对话等待中发 advance */
function onStageClick(): void {
  if (canAdvance.value) {
    if (typewriter !== null && !typewriter.done) {
      typewriter.click(); // 瞬间完成/越过停顿
      shownText.value = typewriter.visible;
      return;
    }
    engine.advance();
  } else if (inWait.value || inVideo.value) {
    engine.advance(); // wait 跳过 / cutscene 跳过（skipable 由引擎裁定）
  }
}

/** 打开历史面板时刷新快照（§四：历史面板是回溯的 UI 皮） */
function refreshHistory(): void {
  historyEntries.value = engine
    .historyView()
    .filter((h) => h.text !== "" || h.speaker !== "");
}

function toggleHistory(): void {
  showHistory.value = !showHistory.value;
  if (showHistory.value) refreshHistory();
}

function rollbackToEntry(index: number): void {
  engine.rollbackTo(index);
  showHistory.value = false;
  syncFromEngine();
}

/** 03 §四.4：滚轮上=回退、下=前进（历史面板是回溯的 UI 皮，核心层只暴露坐标回溯） */
function onWheel(event: WheelEvent): void {
  if (event.deltaY < 0) engine.back();
  else if (event.deltaY > 0) engine.forward();
}

function choose(target: string): void {
  engine.choose(target);
}

function submitInput(): void {
  engine.input(inputValue.value.trim());
  inputValue.value = "";
}

onUnmounted(() => {
  offState?.();
  offEvent?.();
  audioPort.dispose(); // 先停播
  videoPort.dispose();
  audioRenderer?.dispose(); // 再释放已解析资源
  engine.dispose(); // 清挂起的 wait 定时器
  cancelAnimationFrame(rafId); // 停 rAF 帧循环
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <main class="stage" @click="onStageClick" @wheel="onWheel">
    <!-- 固定工具条：单条 flex 行（布局由构造保证不重叠；safe-area 适配移动端） -->
    <div class="toolbar">
      <!-- fail-closed 停机恢复入口：整体重建引擎（正式形态为读档/回标题命令面） -->
      <button
        class="restart"
        type="button"
        title="重新开始"
        aria-label="重新开始"
        @click.stop="restart"
      >
        ↻
      </button>
      <!-- 05 存档：TS 编排 + SavePort（Tauri=加密在 Rust；浏览器演示=localStorage） -->
      <div class="save-load">
        <button type="button" title="保存到槽位 1" @click.stop="saveGame">
          存
        </button>
        <button type="button" title="读取槽位 1" @click.stop="loadGame">
          读
        </button>
      </div>
      <!-- 08 §四 历史面板开关（H 键） -->
      <button
        class="history-toggle"
        type="button"
        title="历史（H）"
        aria-label="历史面板"
        @click.stop="toggleHistory"
      >
        ☰
      </button>
    </div>
    <!-- RenderTargets.overlay（notify toast，08 §二.4） -->
    <ul class="notifications">
      <li v-for="n in notifications" :key="n.id">{{ n.text }}</li>
    </ul>
    <!-- RenderTargets.choices 挂载点（08 §一：选择层在对话层上方） -->
    <section v-if="inMenu" class="choices" aria-live="polite">
      <p v-if="menuPrompt" class="layer-prompt">{{ menuPrompt }}</p>
      <div class="choice-row">
        <button
          v-for="opt in menuOptions"
          :key="opt.target"
          type="button"
          @click.stop="choose(opt.target)"
        >
          {{ opt.text }}
        </button>
      </div>
    </section>
    <!-- RenderTargets.choices：输入形态（input 等待） -->
    <section v-if="inInput" class="choices" aria-live="polite">
      <p class="layer-prompt">{{ inputPrompt }}</p>
      <form class="input-row" @submit.stop.prevent="submitInput">
        <input
          v-model="inputValue"
          type="text"
          maxlength="20"
          placeholder="输入名字…"
          @click.stop
        />
        <button type="submit" @click.stop>确定</button>
      </form>
    </section>
    <!-- RenderTargets.dialogue 挂载点（08 §一）；menu/input 等待时让位 -->
    <section
      v-show="!inMenu && !inInput"
      class="dialogue"
      :class="{ 'nvl-mode': nvlMode === 'active' }"
      aria-live="polite"
    >
      <p
        v-if="speaker"
        class="speaker"
        :style="speakerColor ? { color: speakerColor } : {}"
      >
        {{ speaker }}
      </p>
      <!-- 08-U5/§五：NVL 累积层——已打完的行静态 memo，最新一行走打字机（统一渲染接缝） -->
      <div v-if="nvlMode === 'active'" ref="nvlBody" class="nvl-body">
        <p
          v-for="(html, idx) in nvlPastLines"
          :key="idx"
          class="text"
          v-html="html"
        ></p>
        <p
          class="text"
          v-html="
            renderDialogueLine({ text: nvlTypingLine, typed: shownText }).html
          "
        ></p>
      </div>
      <!-- 08-U3/U4：打字机逐字 + 内联标记（统一渲染接缝：核心层透传，本组件只消费契约） -->
      <p
        v-else
        class="text"
        v-html="renderDialogueLine({ text: shownText }).html"
      ></p>
      <span v-if="canAdvance" class="advance-hint">▼</span>
      <span v-else-if="inWait" class="advance-hint">···</span>
    </section>
    <!-- 08 §四 历史面板（回溯的 UI 皮：NVL 段聚合为块，块级回溯 = 块尾检查点；同走统一渲染接缝） -->
    <section v-if="showHistory" class="history-panel">
      <p class="layer-prompt">历史</p>
      <ul>
        <li
          v-for="block in historyBlocks"
          :key="block.key"
          @click.stop="rollbackToEntry(block.index)"
        >
          <span v-if="block.speaker" class="history-speaker"
            >{{ block.speaker }}：</span
          ><span
            v-if="!block.nvl"
            class="history-text"
            v-html="renderDialogueLine({ text: block.lines[0] ?? '' }).html"
          ></span>
          <div v-else class="history-nvl">
            <p
              v-for="(line, i) in block.lines"
              :key="i"
              class="history-text"
              v-html="renderDialogueLine({ text: line }).html"
            ></p>
          </div>
        </li>
      </ul>
    </section>
    <p v-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style>
/* 视口锁定（自适应基座）：不随内容溢出，层内自行约束 */
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
}
</style>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  padding: clamp(12px, 3vh, 28px) clamp(12px, 4vw, 40px);
  cursor: pointer;
  background: #12121a;
  color: #e6e6f0;
  font-size: clamp(14px, 1.4vw + 8px, 17px);
}

.notifications {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  right: calc(16px + env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  z-index: 10;
}

.notifications li {
  padding: 8px 14px;
  border-radius: 8px;
  background: #2a2f45dd;
  color: #9ece6a;
  font-size: 0.85em;
}

.toolbar {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  z-index: 10;
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.restart {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.restart:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.save-load {
  display: flex;
  gap: 6px;
}

.save-load button {
  padding: 6px 12px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 13px;
  cursor: pointer;
}

.save-load button:hover {
  border-color: #9ece6a;
  color: #9ece6a;
}

.history-toggle {
  width: 36px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 16px;
  cursor: pointer;
}

.history-toggle:hover {
  border-color: #7aa2f7;
  color: #7aa2f7;
}

.history-panel {
  position: fixed;
  top: calc(60px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  z-index: 10;
  width: min(80vw, 360px);
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid #4448;
  border-radius: 12px;
  background: #1e1e2eee;
  box-sizing: border-box;
  padding: 12px;
}

.history-panel ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-panel li {
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85em;
  color: #a9b1d6;
}

.history-panel li:hover {
  background: #26263a;
}

.history-speaker {
  font-weight: 600;
  color: #7aa2f7;
}

.nvl-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialogue {
  position: relative;
  width: min(100%, 960px);
  margin: 0 auto;
  min-height: clamp(5.5em, 18vh, 9em);
  padding: clamp(12px, 2vh, 18px) clamp(16px, 2.5vw, 24px);
  border: 1px solid #4444;
  border-radius: 12px;
  background: #1e1e2ecc;
  box-sizing: border-box;
}

/* 08 §五 NVL 累积层形态：对话容器抬升为阅读区（累积文本自上而下滚动） */
.dialogue.nvl-mode {
  min-height: 46vh;
  display: flex;
  flex-direction: column;
}

.nvl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
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

.choices {
  width: min(100%, 960px);
  margin: 0 auto;
  box-sizing: border-box;
}

.layer-prompt {
  margin: 0 0 10px;
  color: #9aa5ce;
  text-align: center;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.choices button {
  padding: clamp(8px, 1.6vh, 12px) clamp(18px, 3vw, 30px);
  border: 1px solid #7aa2f766;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #e6e6f0;
  font-size: 1em;
  cursor: pointer;
}

.choices button:hover {
  border-color: #7aa2f7;
  background: #26263add;
}

.input-row {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.input-row input {
  width: min(60vw, 320px);
  padding: 10px 14px;
  border: 1px solid #7aa2f766;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #e6e6f0;
  font-size: 1em;
  outline: none;
}

.input-row input:focus {
  border-color: #7aa2f7;
}

.error {
  margin: 0 auto;
  width: min(100%, 960px);
  color: #f7768e;
  font-size: 0.75em;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
</style>
