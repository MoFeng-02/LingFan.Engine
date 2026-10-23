<script setup lang="ts">
/**
 * 舞台视图：舞台盒（基准尺寸 + 宿主下发的平移缩放）与其中的两层节点树。
 *
 * 画布不在这里——帧时钟画布留在页面上，页面的选择器查询才拿得到它（跨组件查询
 * 在小程序里不可靠）。这里只负责把宿主算好的描述树铺成节点。
 */
import NodeTree from "./NodeTree.vue";
import type { MiniNode } from "../mp/index.ts";

defineOptions({ name: "StageView" });

defineProps<{
  /** 舞台层的节点树（基准坐标系） */
  stage: MiniNode[];
  /** 元素层的节点树（同上，叠在舞台层之上） */
  elements: MiniNode[];
  /** 舞台盒的行内样式：尺寸、平移与缩放，由宿主按视口算好 */
  stageBox: string;
}>();
</script>

<template>
  <view class="stage-box" :style="stageBox">
    <NodeTree :nodes="stage" />
    <view class="element-layer">
      <NodeTree :nodes="elements" />
    </view>
  </view>
</template>

<style>
/* 舞台盒：基准尺寸 + 宿主下发的平移与缩放；原点取左上角，与布局口径一致 */
.stage-box {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

/* 元素层不吃点击：叙事元素暂不接管交互（元素交互走覆盖层的命令出口，属后续接线） */
.element-layer {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}
</style>
