<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { assembleProject, SYS, StoryEngine } from "./engine";
import { renderInlineMarkup } from "./ui/inline";
import { createSavePort } from "./infra/savePort";

// —— 多文件工程演示（07 §三）：单列原子文件 + project.json 工程清单 ——
// 此处以内存文件映射模拟磁盘布局；正式形态由 Rust 侧读取 Stories/** 后走同一组装器
// （环境边界 00 §3.2-2：WebView 无 Node，文件 I/O 归 Rust 命令）
const manifest = {
  formatVersion: 1 as const,
  id: "demo",
  entry: "start",
  name: "灵泛演示",
  defines: { "player.gold": 7 },
};

const files = new Map<string, unknown>([
  [
    "Stories/start.json",
    {
      formatVersion: 1,
      id: "start",
      kind: "flow",
      commands: [
        { op: "set", key: "player.gold", value: "+= {20}" },
        {
          op: "say",
          speaker: "灵泛",
          text: "你有 {player.gold:000} 枚金币（插值 + 补零格式化）。",
        },
        {
          op: "say",
          speaker: "灵泛",
          text: "富文本：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。",
        },
        {
          op: "input",
          prompt: "旅人，报上名来：",
          store: "player.name",
        },
        {
          op: "if",
          cond: "{player.gold >= 25}",
          then: [
            {
              op: "notify",
              text: "金币充足！当前 {player.gold} 枚。",
              type: "info",
            },
            {
              op: "func",
              name: "greet",
              params: ["who"],
              body: [
                { op: "say", speaker: "{who}", text: "{who}，欢迎来到灵泛！" },
              ],
            },
            { op: "call", target: "greet", args: ["{player.name}"] },
          ],
          else: [{ op: "say", text: "囊中羞涩……先去赚点钱吧。" }],
        },
        { op: "wait", seconds: 1.5, skipable: true },
        { op: "say", text: "（等待 1.5 秒可点击跳过）" },
        {
          op: "menu",
          prompt: "接下来去哪里？",
          options: [
            { text: "酒馆", target: "inn" },
            { text: "广场", target: "square" },
          ],
        },
      ],
    },
  ],
  [
    "Stories/inn.json",
    {
      formatVersion: 1,
      id: "inn",
      kind: "flow",
      commands: [
        {
          op: "say",
          speaker: "酒馆老板",
          text: "欢迎光临，{player.gold} 金币的贵客！",
        },
        { op: "jump", target: "end" },
      ],
    },
  ],
  [
    "Stories/square.json",
    {
      formatVersion: 1,
      id: "square",
      kind: "flow",
      commands: [
        { op: "say", text: "广场上只有风声。" },
        { op: "jump", target: "end" },
      ],
    },
  ],
  [
    "Stories/end.json",
    {
      formatVersion: 1,
      id: "end",
      kind: "flow",
      commands: [
        {
          op: "say",
          speaker: "灵泛",
          text: "本列播完——列尾之后点击不再推进。",
        },
      ],
    },
  ],
]);

// —— 08-U1：核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
const story = assembleProject(manifest, files);

const speaker = ref("");
const text = ref("");
const canAdvance = ref(false);
const inMenu = ref(false);
const inWait = ref(false);
const inInput = ref(false);
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

let engine: StoryEngine;
let offState: (() => void) | undefined;
let offEvent: (() => void) | undefined;

function handleState({ key, value }: { key: string; value: unknown }): void {
  if (key === SYS.currentDialogSpeaker && typeof value === "string")
    speaker.value = value;
  else if (key === SYS.currentDialogText && typeof value === "string")
    text.value = value;
  else if (key === SYS.waiting) {
    canAdvance.value = value === "dialog";
    inMenu.value = value === "menu";
    inWait.value = value === "wait";
    inInput.value = value === "input";
  } else if (key === SYS.menuPrompt && typeof value === "string")
    menuPrompt.value = value;
  else if (key === SYS.inputPrompt && typeof value === "string")
    inputPrompt.value = value;
  else if (key === SYS.menuOptions && Array.isArray(value))
    rawTexts.value = value as string[];
  else if (key === SYS.menuTargets && Array.isArray(value))
    rawTargets.value = value as string[];
}

function syncFromEngine(): void {
  // 03-R4 / 05：回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话系统键）
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
}

function handleEvent({
  payload,
}: {
  payload: import("./engine").OutboundPayload;
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
  engine.dispose();
  engine = new StoryEngine(story);
  bindEngine(engine);
  speaker.value = "";
  text.value = "";
  canAdvance.value = false;
  inMenu.value = false;
  inWait.value = false;
  inInput.value = false;
  menuPrompt.value = "";
  inputPrompt.value = "";
  inputValue.value = "";
  error.value = "";
  rawTexts.value = [];
  rawTargets.value = [];
  engine.start();
}

engine = new StoryEngine(story);
bindEngine(engine);
engine.start();

// —— 05 存档：TS 编排 + SavePort 适配器（Tauri=K7 Rust 安全；浏览器演示=localStorage 兜底）——
const savePort = createSavePort();

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
      JSON.parse(payload) as import("./engine").SaveDataV1,
    );
    if (!ok) return; // 引擎已拒绝（fail-closed），错误横幅已出站——不得清空、不得报成功
    error.value = "";
    syncFromEngine();
    toast("已读取槽位 1（回到存档时刻）", 2500);
  } catch (e) {
    error.value = `读取失败：${String(e)}`;
  }
}

/** 08-U8：仅在对应等待态发送命令（advance 兼带 skipable wait 的点击解除；守卫仍在引擎） */
function onStageClick(): void {
  if (canAdvance.value || inWait.value) engine.advance();
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
  engine.dispose(); // 清挂起的 wait 定时器
});
</script>

<template>
  <main class="stage" @click="onStageClick" @wheel="onWheel">
    <!-- fail-closed 停机恢复入口：整体重建引擎（正式形态为读档/回标题命令面） -->
    <button
      class="restart"
      type="button"
      title="重新开始"
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
    <section v-show="!inMenu && !inInput" class="dialogue" aria-live="polite">
      <p v-if="speaker" class="speaker">{{ speaker }}</p>
      <!-- 08 §四.3：内联标记由 UI 解析渲染（核心层透传） -->
      <p class="text" v-html="renderInlineMarkup(text)"></p>
      <span v-if="canAdvance" class="advance-hint">▼</span>
      <span v-else-if="inWait" class="advance-hint">···</span>
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
  top: 16px;
  right: 16px;
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

.restart {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 10;
  width: 36px;
  height: 36px;
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
  position: fixed;
  top: 16px;
  left: 60px;
  z-index: 10;
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
