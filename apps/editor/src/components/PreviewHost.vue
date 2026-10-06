<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type {
  AudioPort,
  ElementInstance,
  ResourcePort,
  Story,
  ValueChanged,
  VideoPort,
} from "@lingfan/engine";
import {
  SYS,
  StoryEngine,
  instanceZLayer,
  resolveInstanceZ,
  type LayerZTable,
  type OutboundPayload,
} from "@lingfan/engine";
import {
  builtinBubbleTemplate,
  createAudioRenderer,
  createDialogueTemplateRegistry,
  createElementRegistry,
  createElementResourceResolver,
  createVideoRenderer,
  registerBuiltinElementRenderers,
  renderDialogueLine,
  renderElementTree,
  resolveElementAction,
  Typewriter,
  type AudioRenderer,
  type DialogueTemplateView,
  type VideoRenderer,
} from "@lingfan/ui";

/**
 * 预览视图：当前故事快照跑真引擎。预览为打开时刻的快照运行，编辑不实时渗入。
 * 打字机：单句对话层 Typewriter + rAF 帧驱动；NVL 累积层即时显示
 * （增量渲染优化随 playground 级打磨，预览规模不需要）。
 * 元素层：按 `__elements` 经注册表渲染。
 *
 * **资源供给（编辑器工程模型）**：打开工程后 `resourcePort` 由组合根注入 →
 * 音频/视频渲染器与元素资源一并接上；未打开工程（示例故事）时
 * 保持原语义——媒体静音、图像类元素显示替代文本（不伪造 URL）。
 * 帧驱动表现（animate/transition/shake）仍只在 playground 落地。
 */
const props = defineProps<{
  story: Story;
  /** 已打开工程的资源供给端口（缺省 = 未打开工程：不接媒体与元素资源） */
  resourcePort?: ResourcePort;
  /** 层级表（未打开工程 = 内建默认）——预览据此解析实例级 z */
  layerZ?: LayerZTable;
  createAudioPort: (onError: (message: string) => void) => AudioPort;
  createVideoPort: (onError: (message: string) => void) => VideoPort;
}>();
const emit = defineEmits<{ close: [] }>();

/**
 * 实例级 z：命令参数 `z` 进 SSOT → 该层实例覆盖；
 * `undefined` = 未指定 = 回层默认（`resolveInstanceZ` 三级链）。
 */
const zOverride = ref<Partial<Record<string, number>>>({});
/** 层最终 z = 实例 > 工程层默认 > 内建（render 期调用 → 读 zOverride 建响应式依赖） */
function zOf(layer: keyof LayerZTable): number {
  return resolveInstanceZ(layer, zOverride.value[layer], props.layerZ);
}

// 预览不接小游戏注册表：挂载事件按 fail-closed 显示横幅（不伪造完成）
const engine = new StoryEngine(props.story);
const column = ref("");
const dialogText = ref("");
const speaker = ref("");
/**
 * 本句说话人颜色的**覆盖值**（`say color="#888"`，2026-10-05 治根）。
 *
 * ⚠️ 与**行内标记** `{color=…}`（文本内部，由 `renderDialogueLine` 渲染）是两件事。
 * 空串 = 无覆盖（用角色定义的颜色）。
 */
const dialogColorOverride = ref("");
/**
 * 说话人颜色 = **本句覆盖优先，其次角色定义**。
 *
 * 🔴 此前这里是硬编码 `""` ⇒ 预览**从不显示说话人颜色**（连 `character` 定义的都没有）。
 * 改为派生值：两个来源任一变化都重算（不依赖事件到达顺序）。
 */
const speakerColor = computed(() => {
  if (dialogColorOverride.value !== "") return dialogColorOverride.value;
  return engine.getCharacter(speaker.value)?.color ?? "";
});
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
const elementBanner = ref("");
let notifySeq = 0;
let toastTimer = 0;

const dialogueTemplates = createDialogueTemplateRegistry();
dialogueTemplates.register("bubble", builtinBubbleTemplate, {
  makeDefault: true,
});

/** 媒体渲染错误（含元素资源解析失败以外的端口诊断）汇入停机横幅 */
function reportMediaError(message: string): void {
  errorText.value = message;
}

// —— 音频/视频：仅在打开工程（有资源供给）时接上 ——
// 端口实例归本视图创建（卸载即 dispose），实现在组合根注入的工厂里
const resourcePort = props.resourcePort;
const audioPort: AudioPort | null =
  resourcePort === undefined ? null : props.createAudioPort(reportMediaError);
const videoPort: VideoPort | null =
  resourcePort === undefined ? null : props.createVideoPort(reportMediaError);
const audioRenderer: AudioRenderer | null =
  resourcePort === undefined || audioPort === null
    ? null
    : createAudioRenderer(engine, audioPort, resourcePort, {
        onError: reportMediaError,
      });
const videoRenderer: VideoRenderer | null =
  resourcePort === undefined || videoPort === null
    ? null
    : createVideoRenderer(engine, videoPort, resourcePort, {
        onError: reportMediaError,
        onVideoFinished: () => engine.videoFinished(), // 播放结束 → 引擎解除 video 等待
      });

// —— 元素层：核心只写 `__elements`，此处经注册表渲染（未注册类型 fail-closed 上报） ——
const elements = ref<ElementInstance[]>([]);
const elementLayerEl = ref<HTMLElement | null>(null);
const elementRegistry = createElementRegistry();
registerBuiltinElementRenderers(elementRegistry);
// 资源解析缓存 = @lingfan/ui 共用实现（未打开工程 = 不解析 → 替代文本）
const elementResources = createElementResourceResolver({
  resolve: (path) =>
    resourcePort === undefined
      ? Promise.reject(new Error("未打开工程：无资源根"))
      : resourcePort.resolve(path),
  onResolved: renderElements,
});

function renderElements(): void {
  const host = elementLayerEl.value;
  if (host === null) return;
  renderElementTree({
    registry: elementRegistry,
    container: host,
    elements: elements.value,
    activate: activateElement,
    resolveResource: elementResources.resolveForElement,
    onUnknownType: (type) => {
      elementBanner.value = `元素类型未注册：${type}（fail-closed：不伪造渲染）`;
    },
  });
}

/** 意图 → 命令：`nav` → 核心 navigate；`cmd` → 预览无命令注册表 → fail-closed 上报 */
function activateElement(element: ElementInstance): void {
  const action = resolveElementAction(element.props);
  if (action.kind === "nav") {
    engine.navigate(action.target);
    return;
  }
  if (action.kind === "cmd") {
    elementBanner.value = `元素命令未注册：${action.name}（预览不带命令注册表——fail-closed）`;
  }
}

watch(elements, () => {
  void nextTick(renderElements); // 容器挂载后再渲染
});

const canAdvance = computed(() => waiting.value === "dialog");

const dialogView = computed<DialogueTemplateView>(() => {
  const template =
    dialogueTemplates.resolve(templateName.value) ?? builtinBubbleTemplate;
  return template({
    speaker: speaker.value,
    speakerColor: speakerColor.value,
    lineHtml: renderDialogueLine({ text: shownText.value }).html,
    canAdvance: canAdvance.value,
  });
});

const nvlHtmlLines = computed(() =>
  nvlBuffer.value.map((line) => renderDialogueLine({ text: line }).html),
);

// —— 打字机：单句对话层（rAF 帧驱动；NVL 即时显示） ——
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
  audioRenderer?.pollPosition(); // 媒体位置帧级回写（BGM seek/循环差量归渲染器）
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
  // 实例级 z：命令参数进 SSOT → 预览该层跟随（缺省 = 回层默认）
  const zLayer = instanceZLayer(c.key);
  if (zLayer !== undefined) {
    zOverride.value = {
      ...zOverride.value,
      [zLayer]: typeof c.value === "number" ? c.value : undefined,
    };
    // video 层的 z 在端口内部：解析后交 VideoPort
    if (zLayer === "video") videoPort?.setZIndex?.(zOf("video"));
    return;
  }
  if (c.key === SYS.currentDialogText) {
    dialogText.value = String(c.value ?? "");
    retype(dialogText.value);
  } else if (c.key === SYS.currentDialogSpeaker)
    speaker.value = String(c.value ?? "");
  else if (c.key === SYS.currentDialogColor)
    dialogColorOverride.value = String(c.value ?? "");
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
  else if (c.key === SYS.elements)
    elements.value = (c.value as ElementInstance[] | undefined) ?? [];
});

const offEvent = engine.onEvent((event) => {
  const payload: OutboundPayload = event.payload;
  if (payload.kind === "notify") {
    const id = ++notifySeq;
    toasts.value.push({ id, text: payload.text });
    window.clearTimeout(toastTimer);
    // 提示驻留（提常量）：沿袭现状 2600ms，零行为变化；与 playground 的 3000
    // 是否统一另议
    const NOTIFY_TOAST_DURATION_MS = 2600;
    toastTimer = window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, NOTIFY_TOAST_DURATION_MS);
  } else if (payload.kind === "engine.error") {
    errorText.value = `[${payload.code}] ${payload.message}`;
  } else if (payload.kind === "minigame.mount") {
    minigameBanner.value = `小游戏未注册：${payload.game}（编辑器预览不带注册表——fail-closed，不伪造完成）`;
  }
});

engine.start();

function onStageClick(): void {
  if (errorText.value !== "") return;
  if (waiting.value === "dialog") {
    // 二段式点击：停在 {p}/{w} → 越过；打字未完 → 瞬间完成；已完 → advance
    if (typewriter !== null && !typewriter.done) {
      typewriter.click();
      shownText.value = typewriter.visible;
      return;
    }
    engine.advance();
    return;
  }
  // 纪律「每个等待态都必须有出口」：wait 跳过 / cutscene 跳过（可跳过性由引擎决定）
  if (waiting.value === "wait" || waiting.value === "video") engine.advance();
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

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer);
  window.cancelAnimationFrame(rafId);
  offState();
  offEvent();
  audioPort?.dispose(); // 先停播
  videoPort?.dispose(); // （视频元素挂在 body 上，必须显式卸除）
  audioRenderer?.dispose(); // 再释放已解析 URL（先停播后回收，Blob 场景才安全）
  videoRenderer?.dispose();
  engine.dispose();
});
</script>

<template>
  <div class="preview-overlay">
    <header class="preview-bar">
      <strong>预览</strong>
      <span class="preview-column">{{ column }}</span>
      <span class="preview-note">
        {{
          resourcePort === undefined
            ? "打开时刻的快照 · 未打开工程：音视频与元素资源不解析"
            : "打开时刻的快照 · 资源已接（音视频 / 元素）"
        }}
      </span>
      <span class="spacer"></span>
      <button @click="emit('close')">退出预览</button>
    </header>

    <div class="preview-stage" @click="onStageClick">
      <!-- 舞台元素层（容器 pointer-events:none，可交互元素自身恢复） -->
      <div ref="elementLayerEl" class="element-layer"></div>

      <p v-if="errorText !== ''" class="preview-error">{{ errorText }}</p>
      <p v-if="minigameBanner !== ''" class="preview-banner">
        {{ minigameBanner }}
      </p>
      <p v-if="elementBanner !== ''" class="preview-banner">
        {{ elementBanner }}
      </p>

      <!-- NVL 累积层（video 等待期内容层让位——video 不盖 say 靠让位而非压层） -->
      <div
        v-if="nvlMode !== 'none' && nvlBuffer.length > 0 && waiting !== 'video'"
        class="nvl-layer"
        :style="{ zIndex: zOf('dialogue') }"
      >
        <p v-for="(line, i) in nvlHtmlLines" :key="i" v-html="line"></p>
      </div>

      <!-- 对话（模板视图契约：骨架固定三挂点 + 皮肤类） -->
      <div
        v-if="nvlMode === 'none' && waiting === 'dialog'"
        class="dialogue"
        :class="dialogView.rootClass"
        :style="{ zIndex: zOf('dialogue') }"
      >
        <div class="speaker" v-html="dialogView.speakerHtml"></div>
        <div class="body" v-html="dialogView.bodyHtml"></div>
        <div class="hint" v-html="dialogView.hintHtml"></div>
      </div>

      <!-- 等待/输入/视频/小游戏横幅 -->
      <p v-if="waiting === 'wait'" class="waiting-note">等待中…（点击跳过）</p>
      <div
        v-if="waiting === 'input'"
        class="choices"
        :style="{ zIndex: zOf('choices') }"
        @click.stop
      >
        <p class="layer-prompt">{{ inputPrompt }}</p>
        <form class="input-row" @submit.stop.prevent="submitInput">
          <input v-model="inputValue" type="text" maxlength="20" @click.stop />
          <button type="submit">确定</button>
        </form>
      </div>
      <div
        v-if="waiting === 'menu'"
        class="choices"
        :style="{ zIndex: zOf('choices') }"
        @click.stop
      >
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
      <div v-if="waiting === 'video'" class="choices" :style="{ zIndex: zOf('choices') }">
        <p class="layer-prompt">
          {{
            resourcePort === undefined
              ? "视频等待中（未打开工程，无资源供给——点击跳过）"
              : "视频播放中……（点击跳过）"
          }}
        </p>
      </div>
      <div
        v-if="waiting === 'minigame'"
        class="choices"
        :style="{ zIndex: zOf('minigame') }"
        @click.stop
      >
        <p class="layer-prompt">{{ minigameBanner }}</p>
        <button @click="emit('close')">退出预览</button>
      </div>

      <!-- 通知 toast -->
      <div class="toasts" :style="{ zIndex: zOf('notifications') }">
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
  background: var(--lf-surface-scrim);
  z-index: 50;
  display: flex;
  flex-direction: column;
}
.preview-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--lf-surface-overlay);
  border-bottom: 1px solid var(--lf-border-subtle);
}
.preview-column {
  color: var(--lf-accent);
  font-family: Consolas, monospace;
  font-size: var(--lf-font-md);
}
.preview-note {
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
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
  color: var(--lf-danger);
  border: 1px solid color-mix(in srgb, var(--lf-danger) 53%, transparent);
  border-radius: var(--lf-radius-md);
  padding: 8px 12px;
  margin: 0 0 12px;
}
/* 元素层：不阻塞舞台推进（可交互元素自身恢复 pointer-events） */
.element-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.preview-banner {
  color: var(--lf-warning);
  border: 1px solid color-mix(in srgb, var(--lf-warning) 53%, transparent);
  border-radius: var(--lf-radius-md);
  padding: 8px 12px;
  margin: 0 0 12px;
}
.nvl-layer {
  background: color-mix(in srgb, var(--lf-surface-base) 85%, transparent);
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-md);
  padding: 14px 18px;
  margin-bottom: 12px;
  max-height: 50%;
  overflow: auto;
}
.nvl-layer p {
  margin: 4px 0;
  color: var(--lf-text-primary);
}
.dialogue {
  background: color-mix(in srgb, var(--lf-surface-overlay) 80%, transparent);
  border: 1px solid var(--lf-border-strong);
  border-radius: var(--lf-radius-lg);
  padding: 12px 18px;
  min-height: 96px;
}
.speaker {
  color: var(--lf-accent);
  font-weight: 600;
  margin-bottom: 4px;
}
.body {
  color: var(--lf-text-primary);
  line-height: 1.6;
}
.hint {
  text-align: right;
  color: var(--lf-text-hint);
  font-size: var(--lf-font-sm);
}
.waiting-note {
  color: var(--lf-text-hint);
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
  color: var(--lf-text-secondary);
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
  background: color-mix(in srgb, var(--lf-border-subtle) 93%, transparent);
  border: 1px solid color-mix(in srgb, var(--lf-accent) 33%, transparent);
  border-radius: var(--lf-radius-md);
  padding: 6px 12px;
  margin: 0;
  color: var(--lf-text-primary);
  font-size: var(--lf-font-md);
}
</style>
