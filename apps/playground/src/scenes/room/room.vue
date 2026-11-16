<script setup lang="ts">
/**
 * 通用房间：厨房与书房共用这一个组件，差异全在列的 `bodyProps` 里（标题、背景图、说话列）。
 *
 * 同一份代码画两间屋子，是因为「房间」在这一屏里没有第二种行为——只是在同一个壳里换标题、
 * 换背景、换对话列。真需要不同行为时再拆组件，而不是先按房间各写一份。
 *
 * 开灯要先说话，所以它不在这里改状态，而是 `navigate` 到对话列——一句自然的调用，
 * 不用管检查点怎么记：对话列是纯流程列，说完自己 `jump` 回本列。
 * 画面为什么不换？画面归 `scene` 列管，流程列进列时不碰 `SYS.body`，所以说话期间
 * 这间屋子一直在。逐句回退也白拿：对话列是真列，列帧自带列坐标。
 * 关灯没有台词，就地写状态即可。
 *
 * 画面里还能叠自己的图：灯亮起来之后来一位客人（`sprite-girl.svg`）。
 * 组件就是普通 Vue 模板，`<img>` 直接写；唯一要记住的是**路径写成常量再 `:src` 绑定**，
 * 静态 `src="Images/x.svg"` 会被构建器当成模块说明符去解析，开发期直接 500。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

/** 图像资源逻辑路径：`Resources/` 下相对路径，与列里 `bodyProps.image` 同一口径 */
const GUEST_SPRITE = "Images/sprite-girl.svg";

const props = defineProps<{
  /** 舞台读数与读写口，由宿主注入 */
  env: SceneEnv;
  /** 房间名，显示在左上 */
  title: string;
  /** 背景图逻辑路径（`Resources/` 下的相对路径） */
  image: string;
  /** 开灯时要去的那条对话列 */
  talkColumn: string;
}>();

const hovered = ref("");

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

/** 灯亮不亮：引擎状态，不在这里另存一份 ref——存了就会和存档/回溯后的真值错开 */
const lampOn = computed(() => {
  void revision.value;
  return props.env.get("game.world.lamp") === 1;
});

function toggleLamp(): void {
  if (!lampOn.value) {
    // 去对话列说几句话：纯流程列不改画面，所以这间屋子一直在；真列帧让每句话
    // 各占一个检查点，玩家能一句一句退。列尾那列自己 jump 回本列。
    props.env.navigate(props.talkColumn);
    return;
  }
  props.env.write("world", "lamp", 0);
}

function backToHall(): void {
  props.env.navigate("hall");
}
</script>

<template>
  <div class="room" :class="{ 'is-lit': lampOn }">
    <img class="bg" :src="props.image" alt="" />
    <!-- 灯亮之后来一位客人：图叠在背景之上、按钮之下，随引擎状态出现/消失。
         它没有自己的交互，所以整块 `pointer-events: none`，不挡下面的按钮。 -->
    <img v-if="lampOn" class="guest" :src="GUEST_SPRITE" alt="" />
    <h2 class="title">{{ props.title }}</h2>
    <div class="things">
      <button
        type="button"
        class="thing"
        :class="{ 'is-hovered': hovered === 'lamp' }"
        @mouseenter="hovered = 'lamp'"
        @mouseleave="hovered = ''"
        @click="toggleLamp"
      >
        {{ lampOn ? "关灯" : "开灯（要说话）" }}
      </button>
      <button
        type="button"
        class="thing"
        :class="{ 'is-hovered': hovered === 'door' }"
        @mouseenter="hovered = 'door'"
        @mouseleave="hovered = ''"
        @click="backToHall"
      >
        回大厅
      </button>
    </div>
  </div>
</template>

<style scoped>
.room {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0e1118;
  color: #e6e6f0;
  transition: background 200ms ease;
}

.room.is-lit {
  background: #2a2419;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.6;
  transition: opacity 200ms ease;
}

.room.is-lit .bg {
  opacity: 0.95;
}

.title {
  position: absolute;
  top: 32px;
  left: 48px;
  margin: 0;
  font-size: 26px;
  letter-spacing: 0.1em;
}

/* 立绘：贴在左下、压着地面，与背景同一套「先缩放后叠加」的口径。
   高度按 720 基准算，父容器已随舞台缩放，这里不必再乘任何系数。 */
.guest {
  position: absolute;
  bottom: 0;
  left: 56px;
  height: 78%;
  pointer-events: none;
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.55));
  animation: guest-in 320ms ease-out both;
}

@keyframes guest-in {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.things {
  position: absolute;
  right: 56px;
  bottom: 64px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: stretch;
}

.thing {
  padding: 10px 22px;
  border: 2px solid #3b4261;
  border-radius: 10px;
  background: rgba(10, 10, 16, 0.72);
  color: #cdd6f4;
  font: inherit;
  font-size: 16px;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}

.thing.is-hovered {
  border-color: #7aa2f7;
  background: rgba(122, 162, 247, 0.18);
}
</style>
