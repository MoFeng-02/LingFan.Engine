<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch, type Ref } from "vue";
import {
  SYS,
  StoryEngine,
  type AudioChannel,
  type AudioPort,
  type HostInfo,
  type I18nPort,
  type OrientationMode,
  type PlayerPreferences,
  type ResourcePort,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import {
  Typewriter,
  builtinBubbleTemplate,
  createAudioRenderer,
  createDialogueTemplateRegistry,
  createMinigameRegistry,
  createVideoRenderer,
  renderDialogueLine,
  type DialogueTemplateView,
  type AudioRenderer,
  type VideoRenderer,
} from "@lingfan/ui";

// —— 08-U1：核心层只写状态，UI 只经 ValueChanged 订阅渲染 ——
// 工程与平台端口都由组合根（main.ts）装配注入：本组件只消费契约，不知道任何具体实现
const props = defineProps<{
  /** 07 §三.2 热重载：宿主以 ref 包装供给（换 value = 注入新 Story），消费方显式 .value */
  story: Ref<Story>;
  /** ③ 平台区分：宿主事实（os/form，组合根装配；只读，用于展示与按端分支） */
  host: HostInfo;
  savePort: SavePort;
  resourcePort: ResourcePort;
  /** 01 §四.3 I18N overlay 供给（可选：浏览器形态未装配 = 原文直出） */
  i18nPort?: I18nPort;
  /** 08 §八.2 / U10 玩家偏好（组合根装配：hydrate 后注入，与存档分离） */
  preferences: PlayerPreferences;
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
const inMinigame = ref(false);
const minigameHostEl = ref<HTMLElement | null>(null);
// —— 01 §四.3 语言选择：可用语言 = Lang/ 目录扫描（供给侧 API）；切换 = setLanguage 按需载入 ——
const currentLang = ref("");
const availableLangs = ref<string[]>([]);
// 扫描失败（资源根缺失等）宽容降级：语言列表保持空 = 选择器不出现（与 command 侧降级同语义）
void props.i18nPort?.listLanguages?.().then((langs) => {
  if (langs.length > 0) availableLangs.value = langs;
}).catch(() => {});
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
const nvlTypingLine = computed(() => nvlBuffer.value[nvlBuffer.value.length - 1] ?? "");
const nvlBody = ref<HTMLElement | null>(null);
watch(nvlBuffer, () => {
  void nextTick(() => {
    const body = nvlBody.value;
    if (body !== null) body.scrollTop = body.scrollHeight; // 累积层贴底（阅读最新句）
  });
});
// —— 08 §四.5 对话框模板注册制：宿主装配注册表（作者扩展入口；编辑器可视化创作
// 未来产出同构描述装配到同一注册表）。核心层解析模板名三级优先级 → __dialog_template，
// 此处按名解析（未知名/null 回退默认）。NVL 累积层保持固定骨架（增量渲染纪律）。
const dialogueTemplates = createDialogueTemplateRegistry();
dialogueTemplates.register("bubble", builtinBubbleTemplate, {
  makeDefault: true,
});
// 演示自定义模板（作者纯 TS 创作形态）：居中独白——隐藏说话人行 + 皮肤类
dialogueTemplates.register("center", (input) => ({
  rootClass: "tpl-center",
  speakerHtml: "",
  bodyHtml: input.lineHtml,
  hintHtml: input.canAdvance ? "▼" : "",
}));
const dialogTemplateName = ref<string | null>("");
// —— 06 §二/D5 小游戏注册表：宿主注册（任意技术实现工厂）；未注册 = fail-closed 不伪造完成 ——
const minigames = createMinigameRegistry();
// 演示小游戏「点够次数」：config.target 次点击后成功（signal abort = 立即收尾不回填）
minigames.register("click3", (host, ctx) => {
  return new Promise((resolve) => {
    const target =
      typeof ctx.config.target === "number" ? ctx.config.target : 3;
    host.innerHTML = "";
    host.classList.add("minigame-demo");
    const label = document.createElement("p");
    label.className = "minigame-label";
    label.textContent = `演示小游戏：点 ${target} 次完成`;
    const counter = document.createElement("div");
    counter.className = "minigame-count";
    counter.textContent = `0 / ${target}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "点我";
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
      counter.textContent = `${clicks} / ${target}`;
      if (clicks >= target) resolve({ outcome: "success", score: clicks });
    });
    ctx.signal.addEventListener(
      "abort",
      () => {
        host.innerHTML = ""; // 回溯/导航/销毁：立即收尾（不回填结果）
      },
      { once: true },
    );
    host.append(label, counter, button);
  });
});
const dialogView = computed<DialogueTemplateView>(() => {
  const template =
    dialogueTemplates.resolve(dialogTemplateName.value) ??
    builtinBubbleTemplate;
  return template({
    speaker: speaker.value,
    speakerColor: speakerColor.value,
    lineHtml: renderDialogueLine({ text: shownText.value }).html,
    canAdvance: canAdvance.value,
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
    const prev = blocks[blocks.length - 1];
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
    preferences: props.preferences, // 08 §八.2：通道有效音量合成 + 偏好变化即时重规划
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
    // 08 §四.1：打字速度 = 玩家偏好（SetTextSpeed 语义；每句重建取最新值）
    typewriter = new Typewriter(value, props.preferences.textSpeed);
  } else if (key === SYS.waiting) {
    canAdvance.value = value === "dialog";
    inMenu.value = value === "menu";
    inWait.value = value === "wait";
    inInput.value = value === "input";
    inVideo.value = value === "video"; // 08 §六.5：cutscene 等待（点击/空格 = 跳过）
    inMinigame.value = value === "minigame"; // 06 §二：小游戏等待（宿主经注册表挂载）
  } else if (key === SYS.menuPrompt && typeof value === "string")
    menuPrompt.value = value;
  else if (key === SYS.inputPrompt && typeof value === "string")
    inputPrompt.value = value;
  else if (key === SYS.menuOptions && Array.isArray(value))
    rawTexts.value = value as string[];
  else if (key === SYS.menuTargets && Array.isArray(value))
    rawTargets.value = value as string[];
  // 08 §四.5：模板名（三级优先级解析结果；null = 全局默认回退）
  else if (key === SYS.dialogTemplate)
    dialogTemplateName.value = typeof value === "string" ? value : null;
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
  inMinigame.value = w === "minigame";
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
  // 08 §四.5：模板名随恢复对齐（回溯/读档后模板随快照走）
  const dt = engine.get(SYS.dialogTemplate);
  dialogTemplateName.value = typeof dt === "string" ? dt : null;
  // U4：说话人色随恢复同步
  const def = engine.getCharacter(speaker.value);
  speakerColor.value = def?.color ?? "";
  // 打字机随恢复文本重建（速度 = 玩家偏好）
  typewriter = new Typewriter(text.value, props.preferences.textSpeed);
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
  } else if (payload.kind === "minigame.mount") {
    // 06 §二/D5：宿主经注册表解析工厂挂载；未注册 fail-closed（不伪造完成，等待保持）
    const factory = minigames.get(payload.game);
    if (factory === undefined) {
      error.value = `小游戏未注册：${payload.game}（D5 fail-closed，可回溯/导航离开）`;
      return;
    }
    const host = minigameHostEl.value;
    if (host === null) return;
    const onAbort = (): void => {
      payload.signal.removeEventListener("abort", onAbort);
      host.innerHTML = "";
      inMinigame.value = false;
    };
    payload.signal.addEventListener("abort", onAbort, { once: true });
    void factory(host, { config: payload.config, signal: payload.signal })
      .then((result) => {
        if (payload.signal.aborted) return; // 中断竞态：以 abort 收尾为准
        onAbort();
        engine.resolveMinigame(result);
      })
      .catch((e: unknown) => {
        error.value = `小游戏异常：${String(e)}`;
        onAbort();
      });
  } else if (payload.kind === "save.done") {
    // 05 §五：写档成功（失败走 engine.error 分支，不提示成功）
    toast(`已保存到 ${payload.slot}`);
  } else if (payload.kind === "load.done") {
    // 05 §五：读档完成（引擎已重放到存档坐标）——清错误、同步渲染与媒体
    error.value = "";
    syncFromEngine();
    audioRenderer?.sync(); // 05 §四：读档恢复媒体状态（bgm 曲目 + 播放位置）
    videoRenderer?.sync();
    toast(`已读取 ${payload.slot}（回到存档时刻）`, 2500);
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
  engine = new StoryEngine(props.story.value, {
    i18nPort: props.i18nPort,
    savePort: props.savePort,
  });
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
  inMinigame.value = false;
  minigameHostEl.value?.replaceChildren();
  menuPrompt.value = "";
  inputPrompt.value = "";
  inputValue.value = "";
  error.value = "";
  rawTexts.value = [];
  rawTargets.value = [];
  dialogTemplateName.value = ""; // 08 §四.5：重启回全局默认
  currentLang.value = ""; // 引擎状态重建：语言回默认（显示态与运行态一致）
  nvlMode.value = "none";
  nvlBuffer.value = [];
  typewriter = null;
  engine.start();
}

// 05 §五：SavePort 注入引擎——存档编排（槽位校验/坐标/写读/错误出站）归核心层命令面，
  // UI 只发 save/load 命令并反应完成信号（save.done / load.done）
  engine = new StoryEngine(props.story.value, {
    i18nPort: props.i18nPort,
    savePort: props.savePort,
  });
bindEngine(engine);
audioRenderer = createRenderer();
videoRenderer = createVideo();
engine.start();

// 07 §三.2 热重载：组合根重新组装后注入新 story → 保运行态（变量/历史）重入当前列
// 监听 ref 本身（value 变化才触发；() => props.story 监听恒定 Ref 引用 = 永不触发）
watch(props.story, (fresh) => engine.reloadStory(fresh));

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

// —— 08 §八.2 / U10 玩家偏好：状态归核心层（PlayerPreferences），面板只是 UI 皮 ——
const showPrefs = ref(false);
const prefsView = ref(props.preferences.snapshot()); // 响应式镜像（onChange 同步）
const offPrefs = props.preferences.onChange(() => {
  prefsView.value = props.preferences.snapshot();
  // 速度偏好即时生效于当前句（SetTextSpeed；下句重建自然取新值）
  typewriter?.setSpeed(props.preferences.textSpeed);
});
const PREF_CHANNELS: Array<{ channel: AudioChannel; label: string }> = [
  { channel: "bgm", label: "BGM" },
  { channel: "se", label: "音效" },
  { channel: "ambient", label: "环境" },
  { channel: "voice", label: "语音" },
];

function setPrefVolume(channel: AudioChannel, event: Event): void {
  props.preferences.setVolume(
    channel,
    Number((event.target as HTMLInputElement).value),
  );
}

function setPrefMuted(event: Event): void {
  props.preferences.setMuted((event.target as HTMLInputElement).checked);
}

function setPrefTextSpeed(event: Event): void {
  props.preferences.setTextSpeed(
    Number((event.target as HTMLInputElement).value),
  );
}

/**
 * 08 §八.2 方向偏好：面板只写偏好（空值 = 清除 = 跟随工程默认）；
 * 落壳（OrientationPort）归组合根——组件不碰平台桥接（宪法 §6）。
 */
function setPrefOrientation(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "") {
    props.preferences.clearOrientation();
    return;
  }
  props.preferences.setOrientation(value as OrientationMode);
}

// —— 05 存档：编排归引擎命令面（槽位校验/写读/错误出站都在核心层）——
// UI 只发 save/load 命令并反应完成信号（save.done / load.done）；端口经装配通道注入引擎。

function toast(text: string, duration = 1500): void {
  const id = ++notifySeq;
  notifications.value.push({ id, text });
  setTimeout(() => {
    notifications.value = notifications.value.filter((n) => n.id !== id);
  }, duration);
}

/** 05 §五 save(slot)：引擎内校验槽位/坐标（非等待点 fail-closed 出站）→ 异步写档 → save.done */
function saveGame(): void {
  engine.save("slot_1");
}

/** 05 §五 load(slot)：引擎内读档 + 全量预校验 + 确定性重放 → load.done（UI 在该分支同步渲染） */
function loadGame(): void {
  engine.load("slot_1");
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

/** 01 §四.3 语言切换：setLanguage 按需载入 overlay（供给失败引擎 fail-closed 上报，显示态回退） */
async function changeLang(lang: string): Promise<void> {
  currentLang.value = lang;
  await engine.setLanguage(lang);
  if (engine.get(SYS.currentLanguage) !== lang) currentLang.value = String(engine.get(SYS.currentLanguage) ?? "");
}

onUnmounted(() => {
  offState?.();
  offEvent?.();
  offPrefs?.();
  props.preferences.dispose(); // 08 §八.2：补发未落盘的末次偏好修改（防抖尾结算）
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
      <!-- 08 §八.2 玩家偏好面板开关 -->
      <button
        class="history-toggle"
        type="button"
        title="设置"
        aria-label="设置面板"
        @click.stop="showPrefs = !showPrefs"
      >
        ⚙
      </button>
      <!-- 01 §四.3 语言选择（Lang/ 目录扫描供给；切换 = setLanguage 按需载入译文） -->
      <select
        v-if="availableLangs.length > 1"
        class="lang-select"
        :value="currentLang"
        title="语言"
        @click.stop
        @change.stop="changeLang(($event.target as HTMLSelectElement).value)"
      >
        <option value="">默认</option>
        <option v-for="lang in availableLangs" :key="lang" :value="lang">
          {{ lang }}
        </option>
      </select>
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
    <!-- RenderTargets.minigame（06 §二：宿主经注册表挂载；等待期可回溯 → signal abort 卸载） -->
    <section v-show="inMinigame" class="choices" aria-live="polite" @click.stop>
      <div ref="minigameHostEl" class="minigame-host"></div>
    </section>
    <!-- RenderTargets.dialogue 挂载点（08 §一）；menu/input 等待时让位 -->
    <section
      v-show="!inMenu && !inInput"
      class="dialogue"
      :class="[nvlMode === 'active' ? 'nvl-mode' : dialogView.rootClass]"
      aria-live="polite"
    >
      <!-- 08-U5/§五：NVL 累积层——增量渲染纪律保持固定骨架（不走模板全量重渲） -->
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
      <!-- 08 §四.5 模板骨架：speaker 行 / 正文 / 推进指示器三挂点（内容 = 注册模板产出；
           speaker/hint 随输入稳定，打字帧只有正文变化——Vue diff 不动稳定挂点） -->
      <template v-else>
        <p
          v-if="dialogView.speakerHtml"
          class="speaker"
          :style="speakerColor ? { color: speakerColor } : {}"
          v-html="dialogView.speakerHtml"
        ></p>
        <p class="text" v-html="dialogView.bodyHtml"></p>
        <span
          v-if="canAdvance && dialogView.hintHtml"
          class="advance-hint"
          v-html="dialogView.hintHtml"
        ></span>
      </template>
      <span v-if="inWait" class="advance-hint">···</span>
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
    <!-- 08 §八.2 玩家偏好面板（与存档分离：独立持久化，不随档变动） -->
    <section v-if="showPrefs" class="history-panel prefs-panel" @click.stop>
      <p class="layer-prompt">设置</p>
      <label v-for="c in PREF_CHANNELS" :key="c.channel" class="prefs-row">
        <span class="prefs-label">{{ c.label }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="prefsView.volumes[c.channel]"
          :disabled="prefsView.muted"
          @input="setPrefVolume(c.channel, $event)"
        />
        <span class="prefs-value"
          >{{ Math.round(prefsView.volumes[c.channel] * 100) }}%</span
        >
      </label>
      <label class="prefs-row">
        <span class="prefs-label">静音</span>
        <input
          type="checkbox"
          :checked="prefsView.muted"
          @change="setPrefMuted"
        />
      </label>
      <label class="prefs-row">
        <span class="prefs-label">文字速度</span>
        <input
          type="range"
          min="1"
          max="80"
          step="1"
          :value="prefsView.textSpeed"
          @input="setPrefTextSpeed($event)"
        />
        <span class="prefs-value"
          >{{ Math.round(prefsView.textSpeed) }} 字/秒</span
        >
      </label>
      <label class="prefs-row">
        <span class="prefs-label">屏幕方向</span>
        <select
          :value="prefsView.orientation ?? ''"
          @change="setPrefOrientation"
        >
          <option value="">跟随工程</option>
          <option value="auto">跟随系统</option>
          <option value="portrait">竖屏</option>
          <option value="landscape">横屏</option>
        </select>
      </label>
      <label class="prefs-row">
        <span class="prefs-label">宿主</span>
        <span class="prefs-value">{{ host.os }} · {{ host.form }}</span>
      </label>
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

.lang-select {
  padding: 5px 8px;
  border: 1px solid #4448;
  border-radius: 10px;
  background: #1e1e2ecc;
  color: #9aa5ce;
  font-size: 12px;
  cursor: pointer;
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

/* 08 §八.2 偏好面板：行式布局（label + 滑块 + 数值） */
.prefs-panel label.prefs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-size: 0.85em;
  color: #a9b1d6;
}

.prefs-row .prefs-label {
  width: 4.5em;
  flex: none;
}

.prefs-row input[type="range"] {
  flex: 1;
  accent-color: #7aa2f7;
}

.prefs-row .prefs-value {
  width: 3.5em;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 08 §四.5 模板皮肤（演示自定义模板 center：居中独白形态——骨架固定，皮肤类 + 挂点内容可换） */
.dialogue.tpl-center {
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 1.15em;
  background: #16161ecc;
  border-color: #7aa2f755;
}

/* 06 §二 小游戏挂载层：choices 层之上的宿主容器（内容归注册的工厂，骨架归宿主） */
.minigame-host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.minigame-demo .minigame-label {
  margin: 0;
  color: #a9b1d6;
  font-size: 0.9em;
}

.minigame-demo .minigame-count {
  font-size: 1.6em;
  font-variant-numeric: tabular-nums;
  color: #7aa2f7;
}

.minigame-demo button {
  padding: 8px 22px;
  font-size: 1em;
  border-radius: 8px;
  border: 1px solid #7aa2f755;
  background: #24283b;
  color: #c0caf5;
  cursor: pointer;
}
</style>
