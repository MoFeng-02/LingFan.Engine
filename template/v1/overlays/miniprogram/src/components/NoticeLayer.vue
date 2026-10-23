<script setup lang="ts">
/**
 * 通知层：贴右上角的逐条气泡，不吃点击（挡住下面的层会让舞台点不动）。
 *
 * 气泡的皮肤由 `rootClass` 决定（`tpl-notify-warning` / `tpl-notify-error`），
 * 配色与桌面那份同名同色——两份实现同一套视觉语言。
 */
import type { MiniprogramNoticeData } from "../mp/index.ts";

defineOptions({ name: "NoticeLayer" });

defineProps<{
  /** 当前显示的通知列表（新通知在末尾） */
  notices: MiniprogramNoticeData[];
  /** 层序（核心下发的 z 表） */
  zIndex: number;
}>();
</script>

<template>
  <view class="layer notices" :style="{ zIndex }">
    <view
      v-for="notice in notices"
      :key="notice.key"
      class="notice"
      :class="notice.rootClass"
    >
      <rich-text :nodes="notice.bodyHtml" />
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

/* 通知层：贴右上角的一条条气泡（桌面对应 NotificationLayer），不吃点击 */
.notices {
  top: 24rpx;
  left: auto;
  right: 24rpx;
  width: auto;
  max-width: 560rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16rpx;
  pointer-events: none;
}

.notice {
  padding: 16rpx 28rpx;
  border-radius: 16rpx;
  background: rgba(42, 47, 69, 0.87);
  color: #9ece6a;
  font-size: 26rpx;
}

/* 通知层皮肤：按 tone 换色（与桌面的 .tpl-notify-* 同名同色） */
.notice.tpl-notify-warning {
  color: #e0af68;
}

.notice.tpl-notify-error {
  color: #f7768e;
}

/* 横屏：rpx 的基准是窗口宽度，横过来同一串 rpx 会被放大，方向相关的排版改用 px 定值 */
@media (orientation: landscape) {
  .notices {
    top: 12px;
    right: 12px;
    max-width: 320px;
    gap: 8px;
  }

  .notice {
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
  }
}
</style>
