<script setup lang="ts">
/**
 * 存/读入口：左上角两颗按钮 + 打开后的槽位面板。
 *
 * 组件只管渲染与转发：槽位视图由页面在打开时从宿主取（`loadHostSlotViews`），点选判据与
 * 存读命令都在宿主侧（`chooseHostSlot`），这里不判断空槽、不碰引擎——「谁能点」与「点了
 * 做什么」各只有一处实现。
 *
 * 面板形态与桌面宿主的槽位面板同构（列表 + 标题/时间），移动端换成 rpx 与更大的点击面。
 */
import {
  canChooseSlot,
  type SlotPanelMode,
  type SlotView,
} from "../host/slots.ts";

const props = defineProps<{
  /** 面板模式：null = 收起（只留入口条） */
  mode: SlotPanelMode | null;
  /** 逐槽视图（打开面板时由页面拉取） */
  views: SlotView[];
}>();

const emit = defineEmits<{
  /** 点入口条：打开对应模式的面板 */
  open: [mode: SlotPanelMode];
  /** 点槽位：交给宿主执行存/读 */
  choose: [view: SlotView];
  /** 关闭面板 */
  close: [];
}>();

/** 槽位能否点：判据与桌面面板同一份 */
function pickable(view: SlotView): boolean {
  return canChooseSlot(view, props.mode);
}

/** 槽位上的一行说明：有档给标题，没档写「空槽」 */
function slotHint(view: SlotView): string {
  if (view.empty) return "空槽";
  const title = (view.title ?? "").trim();
  return title === "" ? "已有存档" : title;
}

/** 点槽位：不可点（读档模式的空槽）就什么都不做 */
function pick(view: SlotView): void {
  if (pickable(view)) emit("choose", view);
}
</script>

<template>
  <view class="save-load">
    <view class="entries">
      <view class="entry" @tap.stop="emit('open', 'save')">存</view>
      <view class="entry" @tap.stop="emit('open', 'load')">读</view>
    </view>

    <view v-if="mode" class="sheet">
      <view class="sheet-title">{{
        mode === "save" ? "写入存档" : "读取存档"
      }}</view>
      <view class="slots">
        <view
          v-for="view in views"
          :key="view.id"
          class="slot"
          :class="{ 'slot-disabled': !pickable(view) }"
          @tap.stop="pick(view)"
        >
          <view class="slot-label">{{ view.label }}</view>
          <view class="slot-hint">{{ slotHint(view) }}</view>
        </view>
      </view>
      <view class="close" @tap.stop="emit('close')">关闭</view>
    </view>
  </view>
</template>

<style>
/* 入口与面板都在左上：右上角归通知层，底部归对话与选择层 */
.save-load {
  position: absolute;
  left: 24rpx;
  top: 24rpx;
  pointer-events: auto;
}

.entries {
  display: flex;
  gap: 16rpx;
}

.entry,
.close {
  padding: 12rpx 28rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.4);
  border-radius: 16rpx;
  background: rgba(30, 30, 46, 0.72);
  color: #e6e6f0;
  font-size: 26rpx;
  text-align: center;
}

.entry:active,
.close:active {
  background: rgba(60, 80, 130, 0.72);
}

/* 面板：卡片形态与对话层同源（同一批色值），点击面按移动端放大 */
.sheet {
  margin-top: 16rpx;
  width: 520rpx;
  padding: 24rpx 24rpx 16rpx;
  box-sizing: border-box;
  border: 2rpx solid rgba(68, 68, 68, 0.27);
  border-radius: 24rpx;
  background: rgba(30, 30, 46, 0.92);
  color: #e6e6f0;
}

.sheet-title {
  margin: 0 0 16rpx;
  color: #9aa5ce;
  font-size: 26rpx;
  text-align: center;
}

.slots {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  max-height: 520rpx;
  overflow-y: auto;
}

.slot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 20rpx;
  border: 2rpx solid rgba(122, 162, 247, 0.28);
  border-radius: 16rpx;
  background: rgba(30, 30, 46, 0.8);
}

.slot:active {
  background: rgba(60, 80, 130, 0.72);
}

/* 空槽在读档模式下置灰：引擎读不到档必失败，点了只会多一条提示 */
.slot-disabled {
  opacity: 0.45;
}

.slot-label {
  font-size: 28rpx;
}

.slot-hint {
  color: #9aa5ce;
  font-size: 24rpx;
}

.close {
  margin-top: 16rpx;
}
</style>
