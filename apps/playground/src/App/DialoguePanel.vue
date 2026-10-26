<script setup lang="ts">
/**
 * 对话面板：选择层、输入层、外部系统挂载层与对话层。
 *
 * 四层共用一个 `choices` 骨架类（同一处布局约定），故由同一文件承载；各层的可见性
 * 由等待态决定。面板只填内容与样式——点击选项、提交输入都回抛宿主，叙事流向不变。
 */
import type { LayerId } from "@lingfan-engine/core";
import {
  renderDialogueLine,
  sanitizeFont,
  type ChoiceTemplateView,
  type DialogueTemplateView,
} from "@lingfan-engine/ui";
import { computed, ref } from "vue";
import type { InputCandidate, MenuChoice } from "../host";

/** 累积层容器：宿主接线读它做「新行贴底滚动」 */
const nvlBody = ref<HTMLElement | null>(null);

defineExpose({ nvlBody });

/** 输入框的即时值：唯一事实源在宿主的叙事状态，写入经 `v-model` 回抛 */
const inputValue = defineModel<string>("inputValue", { required: true });

const props = defineProps<{
  /** 层最终 z（实例覆盖 → 工程默认 → 内建） */
  zOf: (layer: LayerId) => number;
  /** 选择层是否在场 */
  inMenu: boolean;
  /** 选择层的模板产出（皮肤类与三个挂点内容） */
  choiceView: ChoiceTemplateView;
  /** 选项（文本 + 目标） */
  menuOptions: MenuChoice[];
  /** 输入层是否在场 */
  inInput: boolean;
  /** 输入提示行 */
  inputPrompt: string;
  /** 输入候选（空数组 = 只有输入框） */
  inputCandidates: InputCandidate[];
  /** 小游戏挂载层是否可见 */
  inMinigame: boolean;
  /** 外部玩法系统接管是否在场（与小游戏共用挂载层） */
  inInteraction: boolean;
  /** 扩展 op 等待是否在场（覆盖层由宿主渲染，此处只让对话层让位） */
  inExtension: boolean;
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
  /** 本句对话字体（空串 = 无声明，正文回落 --lf-story-font） */
  dialogFont: string;
  /** 当前是否可推进 */
  canAdvance: boolean;
  /** 等待态（显示省略号指示器） */
  inWait: boolean;
}>();

/** 过筛后的本句字体（空 = 不上内联样式，正文吃 CSS 变量回退；白名单同 {font=}） */
const storyFont = computed(() => sanitizeFont(props.dialogFont));

/** 事件出口：choose = 选项目标上抛；submit-input = 输入提交上抛。 */
const emit = defineEmits<{
  choose: [target: string];
  "submit-input": [];
}>();

/** 选项点击回抛：模板保持基线字面（点击即上交目标） */
const choose = (target: string): void => emit("choose", target);
/** 输入提交回抛：模板保持基线字面 */
const submitInput = (): void => emit("submit-input");

/** 点候选 = 直接把它的 value 当输入提交（不经输入框，值原样写进变量） */
const submitCandidate = (value: string): void => {
  inputValue.value = value;
  emit("submit-input");
};
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
    <p
      v-if="choiceView.promptHtml"
      class="layer-prompt"
      v-html="choiceView.promptHtml"
    ></p>
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
    <!-- 候选快捷值：点一项就以它的 value 提交（与手打同一个出口） -->
    <div v-if="inputCandidates.length > 0" class="choice-row">
      <button
        v-for="item in inputCandidates"
        :key="item.value"
        type="button"
        :aria-label="item.text"
        @click.stop="submitCandidate(item.value)"
      >
        {{ item.text }}
      </button>
    </div>
  </section>
  <!-- 外部系统挂载层：小游戏经注册表挂载，外部玩法系统接管复用同一层。
       两者都是「整屏接管」形态，可见性分别由 inMinigame / inInteraction 决定；
       容器由默认插槽填入（宿主在收尾回调里清空它）。
       扩展 op 等待（inExtension）只有宿主渲染的覆盖层，无挂载内容，仅让对话层让位。 -->
  <section
    v-show="inMinigame || inInteraction || inExtension"
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
        v-html="
          renderDialogueLine({ text: nvlTypingLine, typed: shownText }).html
        "
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
      <p
        class="text"
        :style="storyFont ? { fontFamily: `'${storyFont}'` } : undefined"
        v-html="dialogView.bodyHtml"
      ></p>
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
  width: min(100%, 960px);
  margin: 0 auto;
  /* UI 层（窗口坐标系）：尺寸按窗口折算随窗口自适应，不再被舞台缩放二次放大 */
  min-height: clamp(104px, 18vh, 150px);
  padding: clamp(10px, 1.6vh, 16px) clamp(16px, 2.4vw, 28px);
  border: 1px solid #4444;
  border-radius: 12px;
  background: #1e1e2ecc;
  box-sizing: border-box;
  pointer-events: auto;
}

/* NVL 累积层形态：对话容器抬升为阅读区（累积文本自上而下滚动） */
.dialogue.nvl-mode {
  min-height: clamp(200px, 46vh, 420px);
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
  /* 项目默认字体档：宿主 setProperty(--lf-story-font) 装配；未声明时变量无效，
     属性落到继承值（等价不设），逐句声明的字体以内联样式覆盖在这里之上 */
  font-family: var(--lf-story-font);
}

.advance-hint {
  position: absolute;
  right: 12px;
  bottom: 8px;
  color: #7aa2f7;
  animation: blink 1.2s infinite;
}

/* 选择 / 输入 / 玩法挂载三层共用这个容器：它住在 UI 层（那一层容器是 pointer-events: none，
   好让空白处的点击穿到舞台上推进对话），所以这层必须自己恢复指针事件——选项按钮、输入行与
   挂载内容都要能接事件。漏了它就是整块面板静默失效（元素还在、就是点不到、也 focus 不上）。 */
.choices {
  position: relative;
  width: min(100%, 960px);
  margin: 0 auto;
  box-sizing: border-box;
  pointer-events: auto;
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
  padding: clamp(8px, 1.2vh, 12px) clamp(16px, 2.4vw, 30px);
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
  width: min(60%, 320px);
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
