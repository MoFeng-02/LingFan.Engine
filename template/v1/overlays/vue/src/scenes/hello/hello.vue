<script setup lang="ts">
/**
 * 身体组件示例（Vue 形态）：这一屏由组件来画。
 *
 * 演示三件事，正好是「组件即列身体」的三条交互通道：
 * 1. **局部状态**：`clicks` 是组件自己的 `ref`，不进引擎、不随存档——换列重挂就归零。
 *    它是「临时交互态」，与「玩家可见事实」刻意分开。
 * 2. **写引擎**：点「点名」经 `env.submit` 提交一条 `say`，落进引擎状态——对话层显示它，
 *    回溯也带得走。组件不持有引擎实例，只经环境这一个读写面。
 * 3. **读引擎**：`env.onChange` 只给「变过了」的信号，数据从 `env` 现读（不在回调里存副本），
 *    所以读到的永远是最新状态；卸载时退订，不留悬挂监听。
 *
 * `env` 由宿主在运行期注入（不随存档）；`greeting` 是故事值（`bodyProps`，JSON 安全、随存档）。
 */
import { computed, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

// 组件名取多词（目录名 hello 才是登记进场景表的身体名，二者各司其职）
defineOptions({ name: "HelloScene" });

const props = defineProps<{ env: SceneEnv; greeting?: string }>();

const greeting = computed(() => props.greeting ?? "你好，旅人");

/** 局部状态：点名次数（组件自己的，重挂归零） */
const clicks = ref(0);

/** 「变过了」信号：只用来触发重算，数据现读，不在这里存状态副本 */
const revision = ref(0);
const stop = props.env.onChange(() => {
  revision.value += 1;
});
onUnmounted(stop);

/** 现读当前列：依赖 revision 让它在引擎变化时重算 */
const column = computed(() => {
  void revision.value;
  return props.env.currentColumn();
});

function call(): void {
  clicks.value += 1;
  // 玩家可见事实落引擎状态：提交一条 say，对话层与回溯都认它
  props.env.submit([
    { op: "say", text: `${greeting.value}（第 ${clicks.value} 次点名）` },
  ]);
}

function back(): void {
  props.env.navigate("title_main");
}
</script>

<template>
  <div class="scene-hello">
    <h2>{{ greeting }}</h2>
    <p>这一屏由组件来画。当前列：{{ column || "（无）" }}</p>
    <p>已点名 {{ clicks }} 次（局部状态，换列归零）。</p>
    <button type="button" aria-label="点名，把次数写进引擎" @click="call">
      点名（写进引擎）
    </button>
    <button type="button" aria-label="返回标题列" @click="back">
      返回标题
    </button>
  </div>
</template>
