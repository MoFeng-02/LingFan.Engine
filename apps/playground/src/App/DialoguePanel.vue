<script setup lang="ts">
/**
 * 对话面板：选择层、输入层、外部系统挂载层与对话层。
 *
 * 四层共用一个 `choices` 骨架类（同一处布局约定），故由同一文件承载；各层的可见性
 * 由等待态决定。面板只填内容与样式——点击选项、提交输入都回抛宿主，叙事流向不变。
 */
import type { LayerId } from "@lingfan/engine";
import {
  renderDialogueLine,
  type ChoiceTemplateView,
  type DialogueTemplateView,
} from "@lingfan/ui";
import { ref } from "vue";
import type { MenuOption } from "../host";

/** 累积层容器：宿主接线读它做「新行贴底滚动」 */
const nvlBody = ref<HTMLElement | null>(null);

defineExpose({ nvlBody });

/** 输入框的即时值：唯一事实源在宿主的叙事状态，写入经 `v-model` 回抛 */
const inputValue = defineModel<string>("inputValue", { required: true });

defineProps<{
  /** 层最终 z（实例覆盖 → 工程默认 → 内建） */
  zOf: (layer: LayerId) => number;
  /** 选择层是否在场 */
  inMenu: boolean;
  /** 选择层的模板产出（皮肤类与三个挂点内容） */
  choiceView: ChoiceTemplateView;
  /** 选项（文本 + 目标） */
  menuOptions: MenuOption[];
  /** 输入层是否在场 */
  inInput: boolean;
  /** 输入提示行 */
  inputPrompt: string;
  /** 小游戏挂载层是否可见 */
  inMinigame: boolean;
  /** 外部玩法系统接管是否在场（与小游戏共用挂载层） */
  inInteraction: boolean;
  /** 视频层在场时对话层让位 */
  inVideo: boolean;
  /** 对白被隐藏 */
  dialogHidden: boolean;
  /** 对话层的模板产出（皮肤类与三个挂点内容） */
  dialogView: DialogueTemplateView;
  /** 累积层形态（`active` = 开启） */
  nvlMode: string;
  /** 已打完的累积行（HTML 片段，memo 后不随打字帧重渲） */
  nvlPastLines: string[];
  /** 累积层最新一行（走打字机） */
  nvlTypingLine: string;
  /** 打字机已上屏的正文 */
  shownText: string;
  /** 说话人配色（空串 = 用样式默认值） */
  speakerColor: string;
  /** 当前是否可推进 */
  canAdvance: boolean;
  /** 等待态（显示省略号指示器） */
  inWait: boolean;
}>();

/** 事件出口：choose = 选项目标上抛；submit-input = 输入提交上抛。 */
const emit = defineEmits<{
  choose: [target: string];
  "submit-input": [];
}>();

/** 选项点击回抛：模板保持基线字面（点击即上交目标） */
const choose = (target: string): void => emit("choose", target);
/** 输入提交回抛：模板保持基线字面 */
const submitInput = (): void => emit("submit-input");
</script>

<template>
  <!-- 选择层：模板骨架 = 提示行 + 选项列表；点击与目标解析回抛宿主 -->
  <section
    v-if="inMenu"
    class="choices"
    :class="choiceView.rootClass"
    :style="{ zIndex: zOf('choices') }"
    aria-live="polite"
  >
    <p v-if="choiceView.promptHtml" class="layer-prompt" v-html="choiceView.promptHtml"></p>
    <div class="choice-row">
      <button
        v-for="(opt, idx) in menuOptions"
        :key="opt.target"
        type="button"
        :aria-label="opt.text"
        @click.stop="choose(opt.target)"
        v-html="choiceView.optionHtml[idx] ?? ''"
      ></button>
    </div>
  </section>
  <!-- 输入形态的选择层（input 等待）：提示行 + 输入行 -->
  <section
    v-if="inInput"
    class="choices"
    :style="{ zIndex: zOf('choices') }"
    aria-live="polite"
  >
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
  <!-- 外部系统挂载层：小游戏经注册表挂载，外部玩法系统接管复用同一层。
       两者都是「整屏接管」形态，可见性分别由 inMinigame / inInteraction 决定；
       容器由默认插槽填入（宿主在收尾回调里清空它）。 -->
  <section
    v-show="inMinigame || inInteraction"
    class="choices"
    :style="{ zIndex: zOf('minigame') }"
    aria-live="polite"
    @click.stop
  >
    <slot />
  </section>
  <!-- 对话层；menu/input 等待时让位 -->
  <section
    v-show="!inMenu && !inInput && !inVideo && !dialogHidden"
    class="dialogue"
    :style="{ zIndex: zOf('dialogue') }"
    :class="[nvlMode === 'active' ? 'nvl-mode' : dialogView.rootClass]"
    aria-live="polite"
  >
    <!-- 累积层保持固定骨架（增量渲染约定），不走模板全量重渲 -->
    <div v-if="nvlMode === 'active'" ref="nvlBody" class="nvl-body">
      <p
        v-for="(html, idx) in nvlPastLines"
        :key="idx"
        class="text"
        v-html="html"
      ></p>
      <p
        class="text"
        v-html="renderDialogueLine({ text: nvlTypingLine, typed: shownText }).html"
      ></p>
    </div>
    <!-- 模板骨架三挂点：说话人 / 正文 / 推进指示器。内容 = 注册模板产出；
         前两者随输入稳定，打字帧只动正文，重渲不会打乱稳定挂点 -->
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
</template>

<style scoped>
/** 对话面板样式：对话框本体与 NVL 累积层形态，含选项、输入行、等待指示等面板内元素。 */

.nvl-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialogue {
  position: relative;
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

/* NVL 累积层形态：对话容器抬升为阅读区（累积文本自上而下滚动） */
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
  position: relative;
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

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

/* 模板皮肤（演示自定义模板 center：居中独白形态——骨架固定，皮肤类 + 挂点内容可换） */
.dialogue.tpl-center {
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 1.15em;
  background: #16161ecc;
  border-color: #7aa2f755;
}

/* 选择层模板皮肤（演示自定义模板 numbered：编号列表形态） */
.choices.tpl-choice-numbered .choice-row button {
  text-align: left;
}

.choices.tpl-choice-numbered .choice-index {
  display: inline-block;
  min-width: 1.6em;
  color: #7aa2f7;
}
</style>
