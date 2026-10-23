<script setup lang="ts">
/**
 * 选择层：菜单与输入两形态互斥（同一张卡片，`choices.options` 或 `choices.input` 二选一）。
 *
 * 层根拦住点击：选项点完不该再穿到舞台层推进一次对话。输入框的值暂存在页面状态里，
 * 提交时一次性交回核心——这样「打字中的字」不会污染叙事状态。
 */
import type { MiniprogramChoicesData } from "../mp/index.ts";

defineOptions({ name: "ChoiceLayer" });

defineProps<{
  /** 选择层数据：菜单、输入或两者皆空的空壳 */
  choices: MiniprogramChoicesData;
  /** 输入框当前值（受控） */
  inputValue: string;
  /** 层序（核心下发的 z 表） */
  zIndex: number;
}>();

const emit = defineEmits<{
  choose: [target: string];
  input: [value: string];
  submit: [];
}>();

/** 选项点击：带回核心给的列 id */
function onChoose(target: string): void {
  emit("choose", target);
}

/** 输入事件：小程序把值放在 `event.detail.value`，Web 形态放在 `target.value` */
function onInput(event: unknown): void {
  const detail = (event as { detail?: { value?: unknown } }).detail;
  if (typeof detail?.value === "string") {
    emit("input", detail.value);
    return;
  }
  const target = (event as { target?: { value?: unknown } }).target;
  if (typeof target?.value === "string") emit("input", target.value);
}

/** 提交：回车或点按钮都走这里 */
function onSubmit(): void {
  emit("submit");
}
</script>

<template>
  <view
    class="layer choices"
    :class="choices.rootClass"
    :style="{ zIndex }"
    @tap.stop
  >
    <view v-if="choices.promptHtml" class="layer-prompt">
      <rich-text :nodes="choices.promptHtml" />
    </view>
    <view v-if="choices.options.length" class="choice-row">
      <view
        v-for="option in choices.options"
        :key="option.key"
        class="option"
        @tap="onChoose(option.target)"
      >
        <rich-text :nodes="option.html" />
      </view>
    </view>
    <view v-if="choices.input" class="input-row">
      <input
        class="input-box"
        :value="inputValue"
        :placeholder="choices.input.prompt"
        @input="onInput"
        @confirm="onSubmit"
      />
      <view class="submit" @tap="onSubmit">
        {{ choices.input.submitText }}
      </view>
    </view>
  </view>
</template>

<style>
.layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
}

/* 选择层：与对话层同一张卡片形态，菜单或输入二选一 */
.choices {
  top: auto;
  bottom: 24rpx;
  left: 24rpx;
  right: 24rpx;
  width: auto;
  padding: 32rpx 40rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.92);
  color: #e6e6f0;
}

.layer-prompt {
  margin: 0 0 20rpx;
  color: #9aa5ce;
  text-align: center;
  font-size: 30rpx;
}

.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
  justify-content: center;
}

.option {
  padding: 16rpx 32rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
  text-align: center;
}

.option:active {
  background: rgba(60, 80, 130, 0.72);
}

.input-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.input-box {
  flex: 1;
  padding: 16rpx 24rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
}

.submit {
  padding: 16rpx 32rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 20rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
  font-size: 30rpx;
}

/* 编号选项皮肤：整行靠左（序号由模板正文自带） */
.choices.tpl-choice-numbered .option {
  text-align: left;
}

/* 横屏：rpx 的基准是窗口宽度，横过来同一串 rpx 会被放大，方向相关的排版改用 px 定值 */
@media (orientation: landscape) {
  .choices {
    bottom: 12px;
    left: 12px;
    right: 12px;
    padding: 12px 16px;
    border-width: 1px;
    border-radius: 12px;
  }

  .layer-prompt,
  .option,
  .input-box,
  .submit {
    font-size: 16px;
  }

  .choice-row {
    gap: 10px;
  }

  .layer-prompt {
    margin-bottom: 10px;
  }

  .option,
  .submit {
    padding: 8px 16px;
    border-width: 1px;
    border-radius: 10px;
  }

  .input-row {
    gap: 10px;
  }

  .input-box {
    padding: 8px 12px;
    border-width: 1px;
    border-radius: 10px;
  }
}
</style>
