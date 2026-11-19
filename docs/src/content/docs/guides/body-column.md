---
title: 列身体：用组件画一整屏
description: 一列的身体可以是一个组件——目录名就是身体名，故事里声明 body，宿主从生成物取组件表，组件经 SceneEnv 读写引擎状态、提交叙事。
---

画一整屏有三条路。声明式的 `elements[]` 把图、文、按钮按坐标摆上舞台，适合规整的版面；`mount` 把常驻界面叠在舞台上，适合状态栏、角标这类不接管整屏的挂件。第三条路是**列身体**：把某一列的整屏交给一个组件来画——探索房间、背包界面、战斗面板，这些需要局部交互和自有布局的屏幕，用组件最顺手。

这一页讲列身体怎么写、怎么读写引擎、怎么提交叙事，以及它和另外两条路的关系。挂载叠加层见 [挂载 UI 组件](/guides/ui-mount/)，整屏页面切换见 [普通页面与对局内界面](/guides/pages/)。

## 目录名就是身体名

一个身体就是 `src/scenes/` 下的一个目录，目录名即身体名，目录里的同名文件是它的入口：

```text
src/
  scenes/
    hall/
      hall.vue
```

规矩和 UI 挂载一致：只认一层 `src/scenes/<名>/<名>.<扩展名>`，文件名等于目录名，`src/scenes/` 在故事源之外（它是宿主资产，不是故事文件）。扩展名可以是 `.vue`、`.tsx` 或 `.ts`——原生形态用一个返回 `{ element, dispose }` 的工厂函数，框架形态用一个组件。

构建期扫描 `src/scenes/` 生成一份组件表 `src/gen/scene_register.g.ts`，并为每个合法名字导出一个具名句柄。故事源引用的是句柄，不是组件本身：

```ts
// src/Stories.src/chapter/hall.ts
import { hall as hallScene } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = hallScene;
export const bodyProps = { title: "大厅" };

export default function hall(): void {}
```

`columnKind = "scene"` 声明这是一列场景；`body` 指定身体名；`bodyProps` 是传给组件的初始属性，**必须是 JSON 安全值**（字符串、数字、布尔、纯对象与数组——函数、`Map`、`Date` 进不去）。场景列的命令落在 `entry`，身体组件自己决定怎么画。

## 组件经 SceneEnv 读写引擎

组件不持有引擎实例。宿主把一份 `SceneEnv` 作为 `env` 属性注入组件——这是组件与引擎之间唯一的读写面：

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { SceneEnv } from "@lingfan-engine/core";

const props = defineProps<{ env: SceneEnv; title?: string }>();

// 读：现读引擎状态，订阅只通知「变过了」
const revision = ref(0);
const stop = props.env.onChange(() => (revision.value += 1));
onUnmounted(stop);
const lampOn = computed(() => {
  void revision.value;
  return props.env.state.getScoped("world", "lamp") === true;
});

// 写：把玩家可见的事实落进引擎状态
function toggleLamp(): void {
  props.env.write("world", "lamp", !lampOn.value);
}
</script>
```

读面有 `get` / `state`（只读状态）、`columns()` / `currentColumn()`（列与当前列）、`historyLength()` / `historyCursor()`（历史）、`interpolate(source)`（插值）、`stage()`（视口与布局尺寸）。写面有 `write(systemId, key, value)` / `writeSilent(...)`（写 `game.<systemId>.<key>`，silent 版不触发变更广播）。`onChange` 只给「变过了」的信号，数据从 `env.get` 现读——这样回溯、读档、跨列跳转都能正确刷新。

舞台尺寸经 `env.stage()` 注入，组件不要自己监听 `resize`：宿主统一算好视口与布局，组件只管按尺寸画。

## 用 submit 提交叙事

组件里发生的「值得记进故事」的事，用 `env.submit(ops)` 提交——它和故事命令走同一条引擎入口，整批生效或原样拒绝：

```ts
function greet(): void {
  props.env.submit([{ op: "say", text: "你推开了门。", speaker: "旁白" }]);
}

function leave(): void {
  props.env.navigate("corridor");
}
```

`submit` 不另建检查点：它提交的操作进入历史，与身体同口径——回溯时一起退、读档时一起还原。`load` 这类存档命令会被整批拒收（返回 `false`，状态原样），其余命令放行。`call(target)` 是提交一条 `call` 的便捷写法。

## 回溯落在进入组件那一步

身体组件内部的局部状态（计数器、折叠面板、临时选中）是组件自己的，不进引擎。回溯时，引擎退到**进入这一列的那一步**：身体换回上一列的样子，组件内部的局部状态随之重置。换句话说，回退的粒度是「列」，不是组件里的每一次点击——想让某个事实可回溯，就把它 `write` 进引擎状态，而不是留在组件的 `ref` 里。

## 跨端：各端提供名字到组件的表

身体名是跨端稳定的契约。故事里只写名字（经句柄），各端宿主提供「名字 → 组件」的查表：Web 与桌面用框架组件或原生工厂，小程序用各自的渲染层。查不到名字时 fail-closed——宿主报一条带名字的诊断、这一列不画身体，而不是静默跳过或伪造一个空屏。组件表由构建期生成，新增身体后重新构建即可。

## 与 elements 和 mount 的关系

- **一列只能选一条路。** 声明了 `body` 的场景列不能再声明 `elements[]`——两者同时声明会在构建期被拒（fail-closed）。要规整版面用 `elements`，要自有交互用 `body`。
- **mount 是叠加层，不冲突。** `mount` 的常驻界面叠在舞台之上，身体在舞台之内，两者可以共存：身体画整屏，挂载层画角标。
- **flow 列也能带身体。** 对话列（`flow`）声明同一个身体时，引擎不重复写身体状态——画面保持不变，只推进对话。

## 注意事项

- `bodyProps` 必须 JSON 安全；函数与复杂对象进不去状态，需要回调走宿主注入的控制面，不走 `bodyProps`。
- 组件经 `SceneEnv` 读写，不要持有引擎实例、不要自己监听舞台 `resize`。
- 想让事实可回溯就 `write` 进引擎；组件局部 `ref` 随回溯重置。
- 新增或改名身体后重新构建，让生成物与故事源对齐；查不到名字会 fail-closed 报诊断。
