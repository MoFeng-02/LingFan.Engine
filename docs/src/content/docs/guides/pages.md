---
title: 普通页面与对局内界面
description: 登录、大厅、存档选择这些页面归宿主，引擎不参与；进游戏只是宿主切自己的界面并让引擎开始跑。判据只有一条——引擎当前在哪一列。
---

玩家打开游戏，先看到标题和「开始」「继续」两个按钮。这一屏和引擎没有关系：它是宿主应用里的一个普通页面，和引擎核心同级。点「开始」之后才有对局——宿主切到游戏界面，引擎从入口列开始跑。

这一页讲两件事：普通页面怎么和引擎共存，对局内的界面（舞台上的 `ui` 列与挂载组件）归谁管。

## 引擎只在对局内存在

引擎的公开面没有「页面」「屏幕」这类概念。它只回答一个问题：**当前停在哪一列**。

```ts
import { createStateReader } from "@lingfan-engine/core";

const reader = createStateReader(engine);
reader.currentColumnId(); // 空串 = 尚未进入任何列
```

空串只有一个含义：引擎还没有进入任何列，也就是还没开始跑。这就是「现在该显示普通页面」的全部判据——不需要额外的开关，也不需要宿主再包一层判断。

`currentColumnType()` 回答的是另一件事：这一列是 `game` 还是 `ui`。它决定这一列**进不进历史与存档**，不决定该画哪一屏。两者别混用。

## 普通页面是宿主代码

登录、大厅、存档选择、设置——这些页面不需要引擎存在就能显示，也不需要引擎知道它们存在。所以它们写在宿主自己的目录里，放哪都行：`src/pages/`、`src/views/` 都可以。`packages/ui` 不为它们提供任何封装。

```vue
<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { createStateReader } from "@lingfan-engine/core";

const reader = createStateReader(engine);
const started = ref(reader.currentColumnId() !== "");
const stop = engine.onStateChanged(() => {
  started.value = reader.currentColumnId() !== "";
});
onUnmounted(stop);

function enterGame(): void {
  engine.start();
}
</script>

<template>
  <LoginPage v-if="!started" @done="enterGame" />
  <GameRoot v-else />
</template>
```

三点：

- **普通页面不需要让舞台让位。** 引擎还没开始跑，舞台上没有可交互的东西，所以不需要 `inert`、也不需要 `aria-hidden`——普通页面自己就是最上面那层。
- **舞台的挂载时机要在装配之前定。** 装配期一次性抓死节点句柄（`#stage`、`#dialogue`、`#choices` 等每个 id 都必须存在）。要么一直挂着、让普通页面盖在上面，要么在装配前就用界面状态决定渲不渲染——不要在运行期摘了再挂，那是一批新节点，宿主手里的句柄全部失效，之后所有对话与元素的写入都打到空气里。
- **进入游戏是宿主的动作。** 不是引擎切屏幕，是宿主切自己的界面状态，然后让引擎开始跑。

## 进入游戏

「开始」在宿主侧翻译成两步：让引擎从入口列开始跑，必要时再跳到第一个能玩的列。

```ts
import { firstGameColumn } from "@lingfan-engine/ui";

function enterGame(): void {
  engine.start(); // 导航到 project.json 的 entry 列
  const target = firstGameColumn(engine.columns(), entry);
  if (target !== undefined) engine.navigate(target);
}
```

`firstGameColumn()` 处理「入口列不是 `game` 列」的情况：入口列本身是 `game` 就直接用它，否则取列清单里第一个 `game` 列；整个工程没有 `game` 列时返回 `undefined`，按钮据此置灰。

「继续」读最近写入的那个槽：

```ts
import { latestSave } from "@lingfan-engine/ui";

const slots = slotIds(resolveSavesConfig(manifest).slots);
const latest = latestSave(await savePort.list(), slots);
if (latest !== undefined) engine.load(latest.slot);
```

没有可用存档时 `latest` 是 `undefined`——把按钮置灰，并在 `title` 上写一行提示，不要静默。

## 对局内：舞台与界面列

进游戏之后玩家看到的一切都在舞台上，分两种列：

| 列类型         | 是什么                             | 进历史与存档 |
| -------------- | ---------------------------------- | ------------ |
| `game`（缺省） | 舞台：对话、元素、选择、视频       | 是           |
| `ui`           | 对局内界面：菜单列、状态面板、挂载 | 否           |

判定只有一处：`type` 是 `game` 的列参与历史与存档，`ui` 列不参与。引擎不知道「页面」是什么，`type` 只回答这一个问题。

## 界面列里写什么

`ui` 列里可以写普通命令，它们照常执行——它是舞台上的界面，不是被跳过的一屏：

```text
scene pause_menu type=ui
  say "要休息一下吗？"
  menu "接下来做什么？"
    "回到故事" -> chapter_one
```

```ts
export const columnType = "ui";
```

`type` 只在非默认值时才写：不写 = `game`，写 `ui` 就是界面层。只有两个取值，界面内部是标题页还是设置页，用列 id 区分，不需要再分一层。

`chapter_one` 不写类型就是 `game` 列：从它开始每一步都可回溯、可存档。

## 挂载 UI 拿引擎操作通道

`mount` 挂上去的组件（状态栏、侧边菜单）需要能操作引擎：暂停、存档、回标题。这条通道是 `HostControls`，由宿主在装配时注入，不走 `props`。

```ts
export interface HostControls {
  pause(): void;
  resume(): void;
  paused(): boolean;
  pauseMedia(channel?: AudioChannel): void;
  resumeMedia(channel?: AudioChannel): void;
  navigate(columnId: string): void;
  save(slot: string): void;
  load(slot: string): void;
  dispose(): void;
}
```

九方法，是 `StoryEngine` 的**收窄**：只暴露菜单需要的那几件事，跨形态也带得过去。它在运行期注入，不进状态、不进存档。

`props` 与 `controls` 是两条不同的通道：

|        | `props`                                            | `controls`         |
| ------ | -------------------------------------------------- | ------------------ |
| 从哪来 | `mount(hub, true, { scene: "forest" })` 的第三参数 | 宿主装配时造的对象 |
| 存不存 | 存，随快照、存档、回溯走                           | 不存，运行期注入   |
| 约束   | 必须 JSON 安全                                     | 任意对象，可含函数 |

同一个组件两条都拿得到。记一句就够：`props` 进存档，`controls` 不进。

Vue 形态下 `UiHost` 把 `controls` 作为 prop 传给每个挂载组件；原生形态下工厂函数拿第二个参数：

```ts
const instance = factory(props, controls);
```

## 暂停

暂停是引擎的公开方法，宿主菜单和挂载 UI 都通过 `HostControls` 调到它：

```ts
engine.pause(); // 幂等
engine.paused(); // true
engine.resume(); // 幂等
```

`pause()` 做四件事：挂起正在跑的定时器并记下剩余毫秒、暂停 `bgm` / `ambient` / `voice` 三条常驻音频通道、暂停视频、把暂停标志写进状态。`se` 是一次性触发，不参与暂停。`resume()` 按剩余毫秒续起定时器，并按状态里的现状逐通道恢复媒体——已经被 `stop` 的通道不会自己响起来。

暂停期间：

- `advance()` / `choose()` 会被拒绝（`pause-active`），不是静默忽略——静默忽略会让玩家以为点击丢了。
- `navigate()` / `save()` / `load()` / `dispose()` 照常可用。暂停时存档是正常需求，存的是暂停前那一刻的位置。

只想停媒体、不冻结叙事时，用 `pauseMedia()` / `resumeMedia()`，不传通道就是全部常驻通道加视频。

## 现状与限制

- **一屏只有一个。** 没有页面栈。要做「设置页返回上一页」，把上一个页面记在宿主自己手里。
- **不要引路由库。** 页面切换由宿主的界面状态驱动，不是 URL。接一个路由进来，你得自己解决「URL 改了但引擎没动」的双重真相。
- **框架层零改动。** 普通页面是宿主代码，换 Vue、React 或纯原生只动宿主，`packages/*` 一行不改。
- **普通页面不要放进 `src/ui/`。** 那里是 `mount` 的扫描面，放进去它就成了能被故事随手挂上摘下的组件。

## 相关

- [故事与叙事流](/concepts/story/)：`type=ui` 与 `type=game` 的语义差别。
- [挂载 UI 组件](/guides/ui-mount/)：`mount` 的目录约定、`uis` 声明与组件表。
- [工程清单 project.json](/reference/manifest/)：`entry` 与 `shell.saves.slots` 的取值规则。
- [存档系统](/concepts/saves/)：槽位名从哪来、存档里存了什么。
