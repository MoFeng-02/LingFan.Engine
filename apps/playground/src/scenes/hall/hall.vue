<script setup lang="ts">
/**
 * 中央大厅：两扇门通向北岛厨房与南岛书房，第三扇还锁着。
 *
 * 这一屏和世界地图是两种身体，所以是两个组件：地图回答「去哪一块陆地」，
 * 大厅回答「进哪一扇门」。把它们塞进同一个组件、靠 props 分支，会让两边都要
 * 判断「我现在是哪一屏」，而这件事本来就由 `SYS.body` 说清楚了。
 *
 * 门只是入口，可点的范围与 `hall.svg` 里画的三扇门对齐（同一套 1280×720 基准坐标）。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

const props = defineProps<{ env: SceneEnv }>();

/** 背景图：逻辑路径按资源根写，走绑定而不是静态属性——静态 `src` 会被构建器当模块去解析 */
const BACKGROUND = "Images/hall.svg";

const DOORS = [
  {
    id: "kitchen",
    label: "厨房（暖光）",
    column: "room_kitchen",
    x: 120,
    y: 196,
    w: 212,
    h: 304,
  },
  {
    id: "study",
    label: "书房（冷光）",
    column: "room_study",
    x: 520,
    y: 176,
    w: 240,
    h: 324,
  },
] as const;

const hovered = ref("");
const lockedNote = ref(false);

/**
 * 引擎状态不是 Vue 的响应式来源：`env.get()` 只当场读一次，computed 不会自己重算。
 * 订阅 `onChange` 只为拿到「变过了」这个信号，数据仍从 `get()` 现读。
 */
const revision = ref(0);
let stopWatching: (() => void) | null = null;

onMounted(() => {
  stopWatching = props.env.onChange(() => {
    revision.value += 1;
  });
});

onUnmounted(() => {
  stopWatching?.();
  stopWatching = null;
});

/** 屋里亮着灯时，大厅的门缝也跟着透出光——读引擎状态，不另存一份 */
const lampOn = computed(() => {
  void revision.value;
  return props.env.get("game.world.lamp") === 1;
});

function enterDoor(column: string): void {
  lockedNote.value = false;
  props.env.navigate(column);
}

function backToMap(): void {
  props.env.navigate("world");
}
</script>

<template>
  <div class="hall" :class="{ 'is-lit': lampOn }">
    <img class="bg" :src="BACKGROUND" alt="" />
    <button
      v-for="door in DOORS"
      :key="door.id"
      type="button"
      class="door"
      :class="{ 'is-hovered': hovered === door.id }"
      :style="{
        left: `${door.x}px`,
        top: `${door.y}px`,
        width: `${door.w}px`,
        height: `${door.h}px`,
      }"
      @mouseenter="hovered = door.id"
      @mouseleave="hovered = ''"
      @click="enterDoor(door.column)"
    >
      <span class="door__label">{{ door.label }}</span>
    </button>
    <button
      type="button"
      class="door door--locked"
      :class="{ 'is-hovered': hovered === 'locked' }"
      style="left: 948px; top: 216px; width: 212px; height: 284px"
      @mouseenter="hovered = 'locked'"
      @mouseleave="hovered = ''"
      @click="lockedNote = true"
    >
      <span class="door__label">锁着的门</span>
    </button>
    <button type="button" class="back" @click="backToMap">回世界地图</button>
    <p class="hint">
      {{
        lockedNote
          ? "铁链没松——这扇门还没做"
          : lampOn
            ? "门缝里透出灯光，屋里有人来过"
            : "挑一扇门进去看看"
      }}
    </p>
  </div>
</template>

<style scoped>
.hall {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: #e6e6f0;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.82;
  transition: opacity 240ms ease;
}

.hall.is-lit .bg {
  opacity: 1;
}

.door {
  position: absolute;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  box-sizing: border-box;
  padding: 10px;
  border: 2px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #cdd6f4;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.door__label {
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(10, 10, 16, 0.6);
  pointer-events: none;
}

.door.is-hovered {
  border-color: #7aa2f7;
  background: rgba(122, 162, 247, 0.16);
}

.door--locked {
  align-items: center;
  color: #f7768e;
}

.back {
  position: absolute;
  top: 32px;
  right: 48px;
  padding: 8px 18px;
  border: 2px solid #3b4261;
  border-radius: 10px;
  background: rgba(10, 10, 16, 0.72);
  color: #cdd6f4;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.back:hover {
  border-color: #7aa2f7;
}

.hint {
  position: absolute;
  left: 50%;
  bottom: 28px;
  margin: 0;
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(10, 10, 16, 0.72);
  color: #a9b1d6;
  font-size: 15px;
  transform: translateX(-50%);
}
</style>
