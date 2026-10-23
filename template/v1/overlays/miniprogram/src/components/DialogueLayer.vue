<script setup lang="ts">
/**
 * 对话层：普通形态三段式（说话人 / 正文 / 推进提示），NVL 形态抬升为阅读区。
 *
 * 两种形态共用同一个容器类（`.dialogue`），NVL 时补 `.nvl-mode` 把高度抬高并改成
 * 纵向排布——与桌面面板同构，差别只在单位（这里用 rpx，横屏在样式表尾部改 px）。
 *
 * 点击整层推进对话：面板本体吃掉点击，不让它穿到舞台层去触发第二次推进。
 */
import type {
  MiniprogramDialogueData,
  MiniprogramNvlData,
} from "../mp/index.ts";

defineOptions({ name: "DialogueLayer" });

defineProps<{
  /** 普通对话形态的数据 */
  dialogue: MiniprogramDialogueData;
  /** NVL 累积形态的数据；非 null 时优先于普通形态 */
  nvl: MiniprogramNvlData | null;
  /** 层序（核心下发的 z 表） */
  zIndex: number;
}>();

const emit = defineEmits<{ advance: [] }>();

function onAdvance(): void {
  emit("advance");
}
</script>

<template>
  <view
    class="layer dialogue"
    :class="nvl ? 'nvl-mode' : dialogue.rootClass"
    :style="{ zIndex }"
    @tap="onAdvance"
  >
    <!-- NVL 形态：累积行自上而下一行行铺开，最后一行是正在打字的当前行 -->
    <view v-if="nvl" class="nvl-body">
      <view v-for="(html, index) in nvl.pastLines" :key="index" class="text">
        <rich-text :nodes="html" />
      </view>
      <view class="text">
        <rich-text :nodes="nvl.typingHtml" />
      </view>
    </view>
    <template v-else>
      <view
        v-if="dialogue.speakerHtml"
        class="speaker"
        :style="{ color: dialogue.speakerColor }"
      >
        <rich-text :nodes="dialogue.speakerHtml" />
      </view>
      <view
        class="text"
        :style="
          dialogue.bodyFont ? { fontFamily: dialogue.bodyFont } : undefined
        "
      >
        <rich-text :nodes="dialogue.bodyHtml" />
      </view>
      <view v-if="dialogue.hintHtml" class="advance-hint">
        <rich-text :nodes="dialogue.hintHtml" />
      </view>
    </template>
  </view>
</template>

<style>
.layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
}

/* 对话层：贴底居中的卡片。
   高度按视口百分比给下限：竖屏约等于桌面的 104~150px，横屏不会因为 rpx 基准换成大宽度而撑破屏。 */
.dialogue {
  top: auto;
  bottom: 24rpx;
  left: 24rpx;
  right: 24rpx;
  width: auto;
  min-height: 16%;
  padding: 32rpx 40rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.8);
  color: #e6e6f0;
}

/* NVL 累积层形态：容器抬升为阅读区（累积文本自上而下滚动） */
.dialogue.nvl-mode {
  min-height: 46%;
  display: flex;
  flex-direction: column;
}

.nvl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  overflow-y: auto;
  min-height: 0;
}

.speaker {
  margin: 0 0 16rpx;
  font-weight: 600;
  font-size: 30rpx;
  letter-spacing: 1rpx;
}

.text {
  margin: 0;
  font-size: 34rpx;
  line-height: 1.7;
  white-space: pre-wrap;
}

/* 推进指示器：右下角闪烁（桌面对应 `.advance-hint`） */
.advance-hint {
  position: absolute;
  right: 24rpx;
  bottom: 16rpx;
  font-size: 26rpx;
  color: #7aa2f7;
  opacity: 0.9;
  animation: blink 1.2s infinite;
}

/* 对话模板皮肤：居中独白形态（与桌面的 .tpl-center 同名同色） */
.dialogue.tpl-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 1.15em;
  background: rgba(22, 22, 30, 0.8);
  border-color: rgba(122, 162, 247, 0.27);
}

/* 横屏：rpx 的基准是窗口宽度，横过来同一串 rpx 会被放大，方向相关的排版改用 px 定值 */
@media (orientation: landscape) {
  .dialogue {
    bottom: 12px;
    left: 12px;
    right: 12px;
    padding: 12px 16px;
    border-width: 1px;
    border-radius: 12px;
  }

  .speaker {
    margin: 0 0 6px;
    font-size: 15px;
    letter-spacing: 0;
  }

  .text {
    font-size: 16px;
  }

  .advance-hint {
    right: 12px;
    bottom: 8px;
    font-size: 13px;
  }
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
</style>
