---
title: 挂载 UI 组件
description: 把一个常驻界面叠在舞台上——目录名就是 UI 名，故事里用 mount 控显隐，宿主从生成物取组件表。
---

有些界面要一直待在舞台上，而不是换掉整屏：状态栏、好感度条、地图角标。它们跟着故事走，随剧情显隐，但从不接管整屏——这条路由 `mount` 命令和一份生成好的组件表铺成。

整屏换界面（标题页、设置页）走的是另一条路，见 [启动界面与渲染切换](/guides/pages/)。

## 目录名就是 UI 名

一个 UI 就是 `src/ui/` 下的一个目录，目录名即 UI 名，目录里的同名文件是它的入口：

```text
src/
  ui/
    hub/
      hub.vue
```

三条硬规矩，构建期逐条查：

- **只认一层。** `src/ui/<名>/<名>.<扩展名>`，不多不少两级。
- **文件名等于目录名。** `ui/hub/hub.vue` 是 UI，`ui/hub/index.vue` 不是。
- **`src/ui/` 在故事源之外。** 故事源在 `src/Stories.src/`，UI 不在里面——它是宿主资产，不是故事文件。

名字用小写字母开头，其后小写字母、数字、`_`、`-`，总长 1 到 32。这个名字同时是 `mount` 的 `name`、`uis` 表里的键，以及生成物里那个导出的标识符。

## 故事源怎么引用

在故事源里默认导入入口文件，绑定名必须与目录名一致：

```ts
// src/Stories.src/lib/hud.ts
import { mount } from "@lingfan-engine/editor";
import hub from "../../ui/hub/hub.vue";

export function showHud(): void {
  mount(hub, true);
}

export function hideHud(): void {
  mount(hub, false);
}
```

`../../ui/hub/hub.vue` 从 `src/Stories.src/<目录>/` 往上两级就是 `src/`，再进 `ui/`。深度随文件位置调整，但终点永远是 `ui/<名>/<名>.<扩展名>`。

`mount(hub, true)` 里的 `hub` 不是字符串，是那个导出：它带着类型，写成未登记的名字会直接编译不过。

要传参数就补第三个实参：

```ts
mount(hub, true, { scene: "forest" });
```

值必须 JSON 安全（能进存档的东西）。它会整份替换掉上一次的 `props`，不是逐字段合并——想改一个字段就传全量。

文本源里写法更短：

```text
scene chapter_one
  mount hub true
  say "雨停了。"
  mount hub false
```

`mount` 的字段、错误码与全部限制见 [舞台与场景 · 挂载 UI](/reference/ops/stage/)，这里不重复。

## 不要导入生成物

工程里有一份构建生成的文件，里面是名字到组件的表。**故事源不要导入它。**

两个原因，任何一个都会让构建直接报错：

- 生成物不参与创作导入——`gen/` 下的文件被排除在可导入范围外。
- 故事源里的导入要能被搬进生成物，而生成物本身在源根之外，搬不过去。

所以故事源只认 `ui/<名>/<名>.<扩展名>` 这一种导入；名字到组件的映射由宿主一侧负责，见下一节。

## 列级 `uis` 声明

`mount` 是运行时命令，宿主事先不知道一列会挂什么。所以每列可以静态声明自己用到的 UI：

```json
{
  "id": "chapter_one",
  "kind": "game",
  "uis": ["hub"],
  "commands": [{ "op": "mount", "name": "hub", "visible": true }]
}
```

在故事源里不用手写这个字段——那一列里出现过 `import hub from "../../ui/hub/hub.vue"`，构建就会把 `hub` 记进列的 `uis`。声明为空时不写这个字段。

两侧都有互锁：

- 用了 `mount` 却没在 `uis` 里声明 ⇒ 构建报错。宿主按 `uis` 预加载，漏声明意味着界面要到挂载那一刻才出现，玩家会看到它闪一下。
- `uis` 里声明了源里不存在的 UI ⇒ 构建报错。预加载会落空，症状与上一条一样。

## 宿主侧接线

组件表来自构建生成的文件，宿主只在一个地方碰它——`src/mounts.ts`。这个文件两件事：把生成的组件表转发出来，再建一个 `mountStore`。

```ts
// src/mounts.ts
export { uis } from "./<生成物路径>";
export const mountStore = createMountStore();
```

生成物的路径由构建工具给出，不手改。三种形态都从这里取表，因此它只出现一次；换形态、换构建工具都不用改第二处。

**原生形态**把容器和表一起交给 `bootHost`，宿主自己往容器里写节点：

```ts
void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  mountsContainer: dom.mounts,
  mountsTable: uis,
});
```

**Vue / React 形态**不给容器，只收新值——节点归框架的渲染树，宿主再往里写就会打架：

```ts
void bootHost({
  dom,
  manifestFile: "project.json",
  stories: STORIES,
  onMounts: (raw) => mountStore.set(raw),
});
```

视图侧订阅 `mountStore`，按表把名字换成组件：

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { selectMounts } from "@lingfan-engine/ui";
import { mountStore, uis } from "./mounts";

const raw = ref(mountStore.snapshot());
const stop = mountStore.subscribe((next) => {
  raw.value = next;
});
onUnmounted(stop);

const items = computed(() => selectMounts(raw.value, uis));
</script>

<template>
  <component
    :is="item.component"
    v-for="item in items"
    :key="item.name"
    v-bind="item.props"
  />
</template>
```

容器与表都不给时，`mount` 只写状态、不出现任何组件——可以先用这条把命令流跑通，再补界面。

`#mounts` 这个容器在 `index.html` 里的位置有讲究：它在对话与工具条之后、转场遮罩之前。于是 UI 盖得住对话层，但盖不住转场与错误条——转场与报错永远是最上面那层。

## 一个状态栏

`src/ui/hub/hub.vue` 是一个最小可用的状态栏：一条贴在底部、只读的小条，自带 scoped 样式，不依赖宿主 CSS。

```vue
<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    value?: string;
  }>(),
  { label: "进度", value: "" },
);
</script>

<template>
  <div class="hub" role="status">
    <span class="hub__label">{{ label }}</span>
    <span v-if="value !== ''" class="hub__value">{{ value }}</span>
  </div>
</template>

<style scoped>
.hub {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: 1px solid rgb(230 230 240 / 18%);
  border-radius: 999px;
  background: rgb(12 15 22 / 72%);
  color: #e6e6f0;
  font-size: 13px;
  /* 只读界面：不吃舞台的点击 */
  pointer-events: none;
}
</style>
```

内容靠 `props` 进来，故事侧这样传：

```text
scene chapter_one
  mount hub true props={"value": "第 1 章"}
  say "雨停了。"
```

三点值得注意：

- **自己带样式。** UI 组件在宿主里没有可继承的外观约定，全靠自己。跨形态复用时更要自带，别指望某一份 `stage.css`。
- **只读的界面设 `pointer-events: none`。** 否则它会吃掉底下舞台的点击，玩家点对话没反应。
- **不要在组件里判断剧情。** 显隐由 `mount` 决定，内容由 `props` 决定；组件自己再去读引擎状态，就多了一处会和存档回滚对不上的地方。

## 现状与限制

- **只有显隐，没有切换。** `visible` 必须是布尔值，没有 toggle 写法；要「切换」就自己记状态再写 `true` / `false`。
- **隐藏不是 `display: none`。** `visible: false` 时组件从渲染树里移除，DOM 上不留痕迹。
- **整表随存档与回溯走。** 挂载状态是引擎状态的一部分，读档或回溯会把它恢复到当时的模样。
- **没有排序控制。** 同时挂多个 UI 时按名字的码点顺序排，不按 `mount` 的先后。

## 相关

- [舞台与场景](/reference/ops/stage/)：`mount` 的完整字段、错误码与限制。
- [启动界面与渲染切换](/guides/pages/)：整屏换界面的那条路。
- [故事与叙事流](/concepts/story/)：`type=ui` 列与 `type=game` 列的差别。
- [工程结构](/project-structure/)：`src/ui/`、`src/gen/` 与故事源的位置关系。
