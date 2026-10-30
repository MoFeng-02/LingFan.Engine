---
title: 启动界面与渲染切换
description: 进游戏前先画一个普通界面，点开始再切到舞台——判断依据只有列 id 与列类型，引擎不认识「启动界面」。
---

进游戏前玩家先看到一屏标题和两个按钮，点「开始」才进故事。这一屏不是引擎里的某种特殊列，也不在任何注册表里——它就是宿主里的一个普通界面，用 `v-if` 叠在舞台上面。

## 引擎只知道两件事

引擎不提供「启动界面」这个概念。它只知道当前停在哪一列（列 id，还没开始跑时是空串），以及那一列是什么类型（`game` 或 `ui`）。「该不该画这一屏」是宿主的判断。

判断收在 `@lingfan-engine/ui` 的 `hostScreenOf()` 里，只有两条：

| 情形                              | 画什么   |
| --------------------------------- | -------- |
| 列 id 是空串（还没开始跑）        | 启动界面 |
| 列类型不是 `game`（标题、设置……） | 启动界面 |
| 其余                              | 舞台     |

两条都要。只看类型的话，引擎开跑之前列 id 是空串、列类型缺省按 `game` 算，首帧就会被判成舞台，画面先黑一下再跳回启动界面。

「进入游戏」就是 `navigate(入口列)`。入口列是 `project.json` 的 `entry`，它指向一个 `type=game` 的列；切过去之后列类型变成 `game`，判断自然翻面。

## 舞台不卸载

启动界面在场时，舞台**留在 DOM 上**，只是被让位：`#stage`、`#nvl`、`#dialogue`、`#choices`、`#notifications`、`#toolbar` 六层各加 `inert` 与 `aria-hidden="true"`，于是它们既接不到点击、也不进无障碍树。根节点不动——启动界面自己挂在根下，是它盖住了舞台。

为什么不是「卸掉舞台、再挂回来」：舞台节点在装配期就一次性抓住了句柄，摘掉再挂等于换一批新节点，宿主手里那十几个句柄全部失效，之后所有对话与元素的写入都打到空气里。

所以真挂载、真卸载的只有启动界面自己——`v-if` 天然保证这一点。原生形态没有框架帮忙，要自己清空容器。

## 三种形态各写一份

启动界面是宿主代码，不是引擎代码，因此每种形态各有一份实现，互不共用：

| 形态  | 落点                      |
| ----- | ------------------------- |
| Vue   | `src/StartScreen.vue`     |
| React | `src/StartScreen.tsx`     |
| 原生  | `src/host/screen/view.ts` |

它不该放进 `src/ui/<名>/`：那里的目录会被构建收进 UI 名字表，启动界面就变成一个能用 `mount` 挂载、也能被故事随手摘掉的组件，而它必须一直在。

## 界面拿到什么

宿主把屏幕态推给视图，视图只负责画。屏幕态长这样：

| 字段            | 含义                                               |
| --------------- | -------------------------------------------------- |
| `screen`        | `"start"` 或 `"game"`，视图据此决定画不画          |
| `title`         | 展示名，取自 `project.json` 的 `name`，缺省用 `id` |
| `slots`         | 存档槽位名，取自 `shell.saves.slots`               |
| `resume.slot`   | 「继续」要读的槽位名；没有可用存档时是 `undefined` |
| `resume.reason` | 不可继续时给玩家看的一行提示；可继续时是空串       |
| `start()`       | 进入游戏，跳到入口列                               |
| `load(slot)`    | 读指定槽位                                         |

命令也在屏幕态里，视图不必知道入口列从哪来、槽位叫什么。

`resume.slot` 与 `resume.reason` 一一对应：可继续时 `reason` 是空串，不可继续时 `slot` 是 `undefined`。「继续」按钮据此 `disabled`，并把 `reason` 放到 `title` 上——按钮灰着但玩家知道为什么。

## 宿主侧接线

Vue 与 React 形态：组合根把每个新屏幕态交给 `screenStore`，视图自己订阅。

```ts
// src/main.ts
import { bootHost } from "./host";
import { screenStore } from "./screen";

void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  onScreen: (view) => screenStore.set(view),
});
```

原生形态什么都不用传：不给 `onScreen` 时宿主自己在 `#stage-root` 下挂一层不透明覆盖物，并负责给六层写 `inert`。给了 `onScreen` 又给原生落法会冲突——两边都想造节点。

`screenStore` 在 `src/screen.ts`，一行：

```ts
export const screenStore = createScreenStore();
```

它只是把屏幕态存起来并通知订阅者，不碰 DOM，三种形态共用。

## 一个最小启动界面

Vue 形态，`src/StartScreen.vue`：

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { screenStore } from "./screen";

const view = ref(screenStore.snapshot());
const stop = screenStore.subscribe((next) => {
  view.value = next;
});
onUnmounted(stop);

const shown = computed(() => {
  const current = view.value;
  if (current === undefined || current.screen !== "start") return null;
  const slot = current.resume.slot;
  return {
    title: current.title,
    reason: current.resume.reason,
    resumable: slot !== undefined,
    resume: () => {
      if (slot !== undefined) current.load(slot);
    },
    start: () => current.start(),
  };
});
</script>

<template>
  <!-- 点击不外传：舞台根的点击是「推进对话」，落到这里会顺带跳一句 -->
  <div v-if="shown !== null" class="screen-start" @click.stop>
    <div class="screen-start__body">
      <h1 class="screen-start__heading">{{ shown.title }}</h1>
      <div class="screen-start__actions">
        <button
          type="button"
          :disabled="!shown.resumable"
          :title="shown.reason"
          @click="shown.resume()"
        >
          继续
        </button>
        <button type="button" @click="shown.start()">开始</button>
      </div>
    </div>
  </div>
</template>
```

React 形态的形状一样，取值换成 `useSyncExternalStore(screenStore.subscribe, screenStore.snapshot, screenStore.snapshot)`：并发渲染要求外部值按快照读，自己 `useState` + `useEffect` 会在首帧读到旧值。

三点值得注意：

- **点击要 `stopPropagation`。** 舞台根的点击是「推进对话」，事件冒上去会顺手跳掉一句台词。
- **样式自己管。** 引擎不知道启动界面长什么样；层级只要低于转场遮罩，转场就还能盖在它上面。
- **不要在界面里判断状态。** 能不能继续、标题是什么、跳到哪一列，全在屏幕态里；视图多做一次判断，就多一处和宿主不一致的可能。

## 界面列里写什么

故事侧就是普通的 `ui` 列：

```text
label title_main:
  say "欢迎来到我的故事。"
  menu "接下来去哪里？"
    "开始游戏" -> chapter_one
```

```ts
export const columnType = "ui";
```

`ui` 列里的命令不是废的——启动界面只在该显示时显示，换一个没接这一屏的宿主，这一段照常按命令跑。所以把「开箱能玩」的最小流程写进 `ui` 列，是个不亏的习惯。

`chapter_one` 不写类型就是 `game` 列：从它开始每一步都可回溯、可存档。

## 现状与限制

- **一屏只有一个。** 没有页面栈。要做「设置页返回上一页」，把上一个界面的列 id 记在自己手里，再 `navigate` 回去。
- **不要引路由库。** 界面切换由列切换驱动，不是 URL。接一个路由进来，你得自己解决「URL 改了但引擎没跳」的双重真相。
- **框架层零改动。** 引擎不认识启动界面，所以换 Vue、React 或纯原生只动宿主，`packages/*` 一行不改。

## 相关

- [故事与叙事流](/concepts/story/)：`type=ui` 与 `type=game` 的语义差别。
- [挂载 UI 组件](/guides/ui-mount/)：叠在舞台上的常驻界面走另一条路。
- [工程清单](/reference/manifest/)：`entry`、`name` 与 `shell.saves.slots` 的取值规则。
- [存档系统](/concepts/saves/)：槽位名从哪来、存档里存了什么。
