---
title: 用页面渲染界面列
description: 把 ui 列交给一个整屏页面去画——用 Vue、React 或原生 DOM 都行。页面怎么读状态、怎么下命令、切走时为什么必须真销毁，以及它和 HUD 的区别。
---

`type=ui` 的列不进历史、不进存档、不建检查点——它是界面，不是剧情。这类列有两种画法：

- **按 op 画**：跟 `game` 列一样，用 `say` / `menu` / `scene` 里的元素一层层堆出来。开箱就能跑。
- **交给页面画**：宿主按列 id 挂一个整屏页面上去。页面可以用 Vue、React，也可以直接写 DOM。

这一页讲第二种。它更适合标题页、设置页、存档列表这类「一屏换一屏」的界面，也是唯一能让你用上框架组件生态的方式。

## 两条边界

页面能做的事很多，但只有两条硬边界，剩下的都是自由：

**一、读走 `StateReader`，写走命令面。** 页面想知道什么就读什么（当前列、等待态、菜单选项、元素表……），想改变什么就调引擎的命令（`navigate` / `choose` / `input` / `save` / `load`）。它不碰状态键，也不自己造存档格式——绕过去就等于绕过了保留键守卫与快照一致性。

**二、切走即真销毁。** 页面切换是**完整界面替换**，不是显示切换。离开时必须真销毁：Vue 的 `app.unmount()`、React 的 `root.unmount()`、原生的清空容器并解绑监听器。把旧界面「藏起来」留在后台，功能上看起来一样，但内存里堆着几份界面，而且「此刻在哪个界面」有两个答案。

一句话：**卸载逻辑归宿主写，引擎不管也不检测**。自由度在你手上，代价是你得自己写对。

## 页面和 HUD 不是一回事

|          | 页面                     | HUD                          |
| -------- | ------------------------ | ---------------------------- |
| 占位     | 整屏（占满视口）         | 叠加层（悬浮在游戏画面上）   |
| 生命周期 | 切走即销毁               | 常驻，可隐藏但**不卸载**     |
| 为何如此 | 一屏只该有一个界面       | 玩家随时再打开，重建会丢状态 |
| 适用     | 标题页、设置页、存档列表 | 工具栏、小地图、常驻状态条   |

HUD 用 `createHudPanel` 建：`mount(container, ctx)` 一次，之后 `setVisible(false)` 只是给根节点加 `hidden` 属性（实例还活着，滚动位置、展开的分组都还在），`destroy()` 才是真拆。

## 注册一个页面

页面表在宿主里，不在引擎里。三步：

```ts
import {
  bootHost,
  createPageRegistry,
  createTitlePage,
  optional,
} from "./host";

const pages = createPageRegistry();
pages.register("title_main", createTitlePage({ nextColumnId: "chapter1" }));

void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  pageContainer: optional("#page"), // 整屏界面挂这里
  pages,
});
```

`register(列 id, 工厂)` 的键是**列 id**，不是列的类型。引擎进到某一列，宿主就把那一列注册过的页面挂上去；没注册的列照常按 op 渲染——**没有自定义界面是合理降级，不是错误**。

同一个 id 再注册一次是替换，不是追加。id 不合规（要匹配 `/^[a-z][a-z0-9_-]{0,31}$/`）或工厂不是函数，注册会被拒绝并上报，不会静默变成「这列永远按 op 渲染」。

## 页面拿到什么

工厂收到一个 `PageContext`，只有四样东西：

```ts
interface PageContext {
  reader: StateReader; // 只读：当前列、等待态、菜单、元素……
  engine: Pick<StoryEngine, "navigate" | "choose" | "input" | "save" | "load">;
  preferences: PlayerPreferences; // 玩家偏好（音量、静音、文字速度）
  gameState: GameStateWriter; // 页面自己的状态，走 game.<系统>.<键> 命名空间
}
```

`engine` 只给五个方法是刻意的：页面需要的是「跳转、选中、提交输入、存、读」，不是整个引擎。多给一个方法，就多一种绕开契约的写法。

页面自己跨多次挂载要保留的东西（比如上次选到第几页），放进 `gameState` ——它随存档与回溯走。放模块级变量也行，但那等于绕过存档：读档回来它不会复位。

## 一个最小页面

原生 DOM 版（模板自带的 `src/host/pages/title-page.ts`）：

```ts
import { createTitlePage } from "./host";

pages.register("title_main", createTitlePage({ nextColumnId: "chapter1" }));
```

Vue 版（`src/pages/title-page.vue`，在组合根注册）：

```ts
import { createApp } from "vue";
import TitlePage from "./pages/title-page.vue";

pages.register("title_main", (ctx) => {
  const app = createApp(TitlePage, { ctx });
  return {
    mount(container) {
      app.mount(container);
    },
    unmount() {
      app.unmount();
    },
  };
});
```

Vue 组件里读状态和下命令：

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { PageContext } from "../host";

const props = defineProps<{ ctx: PageContext }>();
const at = computed(() => props.ctx.reader.currentColumnId());

function start(): void {
  props.ctx.engine.navigate("chapter1"); // 按列名跳转
}
function resume(): void {
  props.ctx.engine.load("auto"); // 无档时只出一条错误事件，不抛
}
</script>

<template>
  <section class="page-title">
    <h1>我的游戏</h1>
    <p>{{ at === "" ? "尚无当前界面" : `当前界面：${at}` }}</p>
    <button @click="start">开始游戏</button>
    <button @click="resume">继续</button>
  </section>
</template>
```

三点值得注意：

- **跳转只认列名。** `navigate("chapter1")` 里的 `chapter1` 必须是产物里真实存在的列 id；页面不需要知道它是 JSON 写的还是 TS 写的。
- **「继续」不用预检存档。** `load("auto")` 读引擎的自动存档槽，没有存档时引擎只发一条 `engine.error` 事件，不抛异常。
- **样式自己管。** 引擎不知道「标题页」长什么样，页面容器里的一切都由你的组件与样式表决定。

## 页面上写什么列

故事侧就是普通的 `ui` 列：

```text
scene title_main type=ui
  say "欢迎来到我的游戏。"
  menu "接下来去哪里？"
    "开始游戏" -> chapter1

scene chapter1
  say "故事从这里开始。"
```

`ui` 列里那些 op 不是废的——它们是**没有页面时的兜底**。宿主注册了页面，页面盖在上面；换一个没接页面的宿主，这一段照常按 op 跑。所以把「开箱能玩」的最小流程写进 `ui` 列，是个不亏的习惯。

`chapter1` 不写 `type` 就是 `game` 列：从这里开始每一步都可回溯、可存档。

## 现状与限制

- **页面容器是可选的。** 骨架的 `index.html` 里有 `<div id="page">`，用 `optional("#page")` 取；你的页面结构若没有这个槽位，传 `null` 就是「所有列都按 op 渲染」，不报错。
- **不要引路由库。** 界面切换由列切换驱动，不是 URL。接一个路由进来，你得自己解决「URL 改了但引擎没跳」的双重真相。
- **框架层零改动。** 引擎不认识页面，所以换 Vue、React 或纯原生只动组合根，`packages/*` 一行不改。
- **不提供页面栈。** 一次只有一页。要「设置页返回上一页」，用 `navigate` 跳回原来那个列的 id——别指望引擎替你记。

## 相关

- [故事与叙事流](/concepts/story/)：`type=ui` 与 `type=game` 的语义差别。
- [菜单、输入与通知](/guides/menu-input/)：`menu` 指令与界面列不是一回事。
- [舞台元素](/concepts/elements/)：不写页面时，界面列用什么画出画面。
