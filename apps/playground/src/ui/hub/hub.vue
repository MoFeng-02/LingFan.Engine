<script setup lang="ts">
/**
 * 常驻状态栏示例：由故事源用 `mount(hub, true)` 挂上、`mount(hub, false)` 摘下。
 *
 * 三条约定（示例本身也要守）：
 * - 自带 scoped 样式：UI 组件在宿主里没有可继承的外观约定，不依赖任何一份 `stage.css`。
 * - 只读部分设 `pointer-events: none`：否则它会吃掉底下舞台的点击，玩家点对话没反应；
 *   要交互的控件自己在样式里恢复指针事件。
 * - 不读引擎状态：显隐由 `mount` 决定，内容由 `props` 决定；组件自己再判断一次剧情，
 *   就多了一处会和存档回滚对不上的地方。要操作引擎一律经注入的 `controls`。
 */
import type { HostControls } from "@lingfan-engine/core";

withDefaults(
  defineProps<{
    /** 状态栏左侧的说明字。 */
    label?: string;
    /** 状态栏右侧的值，通常由故事在 `mount` 时传进来。 */
    value?: string;
    /** 操作通道：挂载 UI 想提供菜单时用它，由宿主在渲染挂载层时注入。 */
    controls?: HostControls;
  }>(),
  { label: "进度", value: "", controls: undefined },
);
</script>

<template>
  <div class="hub" role="status">
    <span class="hub__label">{{ label }}</span>
    <span v-if="value !== ''" class="hub__value">{{ value }}</span>
    <!-- 挂载 UI 也提供菜单：这个按钮就是「游戏内界面也能暂停引擎」的最小证明 -->
    <button
      v-if="controls"
      type="button"
      class="hub__menu"
      title="菜单（Esc）"
      aria-label="菜单"
      @click.stop="controls.pause()"
    >
      ☰
    </button>
  </div>
</template>

<style scoped>
.hub {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 6px 14px;
  border: 1px solid rgb(230 230 240 / 18%);
  border-radius: 999px;
  background: rgb(12 15 22 / 72%);
  color: #e6e6f0;
  font-size: 13px;
  line-height: 1.5;
  /* 只读界面：不吃舞台的点击 */
  pointer-events: none;
}

.hub__label {
  color: #a9b1d6;
  letter-spacing: 0.06em;
}

.hub__value {
  font-weight: 600;
}

/* 容器不吃事件（只读界面不挡舞台点击），按钮这一处恢复 */
.hub__menu {
  pointer-events: auto;
  padding: 0 6px;
  border: none;
  border-radius: 999px;
  background: none;
  color: #a9b1d6;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
}

.hub__menu:hover {
  color: #7aa2f7;
}
</style>
