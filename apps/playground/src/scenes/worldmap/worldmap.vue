<script setup lang="ts">
/**
 * 世界地图：这一屏由 `world` 列的 `body` 指定，宿主按名字从生成物里取出本组件。
 *
 * 画面是现成的手绘 SVG（`Resources/Images/worldmap.svg`，`viewBox="0 0 1280 720"`），
 * 它只当背景铺满；可点的三块热区是叠在上面的透明按钮，坐标按同一套 1280×720 基准写，
 * 因此整场缩放由宿主统一做，组件自己一乘缩放系数就会和背景错位。
 *
 * 两次点击才进房间：第一次把「看中的是哪一间」写进 `game.world.focus`（引擎状态，
 * 跟着存档与回溯走，不是组件里的临时高亮），第二次才 `navigate`。这样误触只是换个高亮，
 * 不会把人直接弹进另一屏。
 *
 * 状态键一律写 `game.world.*`：组件能写的只有 `game.<系统>.<键>` 这一段，
 * 而「去过哪些房间」是数组，`set` 只收标量，所以数组走 `write` 整份替换。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

const props = defineProps<{ env: SceneEnv }>();

/**
 * 引擎状态不是 Vue 的响应式来源：`env.get()` 只是当场读一次，computed 不会自己重算。
 * 订阅 `onChange` 只为一个信号「状态变过了」，读数仍然走 `get()`——契约里也写明
 * 读面不保证引用稳定，不要把返回值缓存起来当数据源。
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

/** 背景图：逻辑路径按资源根写，走绑定而不是静态属性——静态 `src` 会被构建器当模块去解析 */
const BACKGROUND = "Images/worldmap.svg";

/** 热区：坐标与 `worldmap.svg` 里的三块陆地/石台对齐，`column` 是要去的列名 */
const SPOTS = [
  {
    id: "kitchen",
    label: "北岛 · 厨房",
    column: "room_kitchen",
    x: 250,
    y: 120,
    w: 230,
    h: 170,
  },
  {
    id: "hall",
    label: "中央 · 大厅",
    column: "hall",
    x: 520,
    y: 262,
    w: 252,
    h: 136,
  },
  {
    id: "study",
    label: "南岛 · 书房",
    column: "room_study",
    x: 760,
    y: 400,
    w: 250,
    h: 150,
  },
] as const;

/** 悬停只影响当下这一帧的观感，回溯时不该跟着变回去，所以留在组件里 */
const hovered = ref("");

/** 去过哪些房间：引擎状态，读不到时按「哪儿都没去过」处理 */
const visited = computed(() => {
  void revision.value;
  const raw = props.env.get("game.world.visited");
  return Array.isArray(raw) ? (raw as string[]) : [];
});

/** 看中哪一间：同样在引擎状态里，点错一次只是换高亮 */
const focused = computed(() => {
  void revision.value;
  const raw = props.env.get("game.world.focus");
  return typeof raw === "string" ? raw : "";
});

/** 右上的门画了锁，还进不去；给个明确回执，别让人反复点 */
const lockedNote = ref(false);

function spotClass(id: string): Record<string, boolean> {
  return {
    "is-hovered": hovered.value === id,
    "is-focused": focused.value === id,
    "is-visited": visited.value.includes(id),
  };
}

function onSpotClick(id: string, column: string): void {
  lockedNote.value = false;
  if (focused.value !== id) {
    props.env.write("world", "focus", id);
    return;
  }
  if (!visited.value.includes(id)) {
    props.env.write("world", "visited", [...visited.value, id]);
  }
  props.env.navigate(column);
}

function hint(): string {
  if (lockedNote.value) return "那扇门还锁着——先把附近的房间走一遍吧";
  const spot = SPOTS.find((item) => item.id === focused.value);
  if (spot === undefined) return "点一处看看，再点一次就进去";
  return `再点一次「${spot.label}」就进去`;
}
</script>

<template>
  <div class="world">
    <img class="bg" :src="BACKGROUND" alt="" />
    <button
      v-for="spot in SPOTS"
      :key="spot.id"
      type="button"
      class="spot"
      :class="spotClass(spot.id)"
      :style="{
        left: `${spot.x}px`,
        top: `${spot.y}px`,
        width: `${spot.w}px`,
        height: `${spot.h}px`,
      }"
      @mouseenter="hovered = spot.id"
      @mouseleave="hovered = ''"
      @click="onSpotClick(spot.id, spot.column)"
    >
      <span class="spot__label">{{ spot.label }}</span>
    </button>
    <button
      type="button"
      class="spot spot--locked"
      :class="{ 'is-hovered': hovered === 'locked' }"
      style="left: 1000px; top: 140px; width: 180px; height: 150px"
      @mouseenter="hovered = 'locked'"
      @mouseleave="hovered = ''"
      @click="lockedNote = true"
    >
      <span class="spot__label">禁地</span>
    </button>
    <p class="hint">{{ hint() }}</p>
  </div>
</template>

<style scoped>
.world {
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
}

.spot {
  position: absolute;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  box-sizing: border-box;
  padding: 6px;
  border: 2px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: #cdd6f4;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.spot__label {
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(10, 10, 16, 0.55);
  pointer-events: none;
}

.spot.is-hovered {
  border-color: #7aa2f7;
  background: rgba(122, 162, 247, 0.16);
}

.spot.is-focused {
  border-color: #e0af68;
  background: rgba(224, 175, 104, 0.2);
}

.spot.is-visited .spot__label {
  color: #9ece6a;
}

.spot--locked {
  align-items: center;
  color: #f7768e;
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
