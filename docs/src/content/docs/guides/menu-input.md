---
title: 菜单、输入与通知
description: menu 的选项怎么连到列、input 的值落到哪个变量、notify 的浮层提示怎么写，以及三个等待点各自由谁解除。
---

等待点里除了 `say`，还有 `menu`、`input`、`wait` / `pause`。这一页讲怎么用，以及它们各自等的是谁。

## menu

`menu` 是一个块语句，选项写成缩进行：

```text
menu "接下来去哪里？"
  "去码头" -> dock
  "回家" -> home
```

每个选项的写法是 `"文案" -> 目标列`。目标列**不加引号**，是列 id。至少要有选项，一个都没有会报「menu 至少需要一个选项」。

`menu` 进入 `menu` 等待态，玩家选中一项后跳到那一项的目标列，继续执行。目标列不存在会在跳转时报错，不会静默停下。

菜单提示可以省：

```text
menu
  "接受" -> accept
  "拒绝" -> refuse
```

### 选项文案会被翻译，目标列不会

译文表只作用于选项**文案**。目标列名原样传给引擎——它是列 id，不是给人看的文字，不该出现在译文表里。

### 想记住玩家选了什么

`menu` 本身不写变量，跳转是控制转移。要记住选择，就在目标列里自己写：

```text
menu "今晚吃什么？"
  "面" -> noodle
  "饭" -> rice

label noodle:
  set "player.choice" "面"
  jump dinner
```

引擎会写 `menuSelected` 记录序号，但它是渲染层用的内部键，别拿它当业务变量。

### 在菜单列里存档

列声明可以带 `type=menu` 或 `type=ui`。进这类列时引擎记下进入前的可回溯坐标，在这类列里存档存下来的是**进入前的游戏位置**，不是菜单本身。

这和 `menu` 指令不是一回事：`menu` 指令建检查点，玩家回退会落回菜单重选；而 `type=menu` 的**列**不建检查点，它是「覆盖」在故事上的一层。两件事分开看。

## input

`input` 问一句话，把玩家输入写进一个变量：

```text
input "你叫什么名字？" store="player.name"
say "你好，{player.name}！"
```

两个字段都是必填。缺了 `store` 解析期就拒绝，错误信息是「input 需要 prompt 与 store」。

写进去的变量是**全局**的——玩家的回答会跟着存档走。名字里的 `.` 只是命名习惯，不构成嵌套结构，`player.name` 就是一个叫这个名字的键。

`input` 进入 `input` 等待态，由宿主回填：

```ts
engine.input("阿岚");
```

宿主在你的输入框提交时调这一句，引擎把值写进 `store` 指向的变量，然后继续执行。

`input` 没有选项式形态。要做「三选一」，用 `menu`。

## wait 与 pause

两个都是定时停顿：

```text
wait 1.5
pause 2
```

`wait` 可以加 `skipable`，让玩家点一下提前结束：

```text
wait 3 skipable
```

`pause` 没有 `skipable`，秒数到了才走。它适合用在不想被玩家打断的地方。

**无参的 `pause` 会警告**，按 0 秒处理，也就是没有任何停顿效果。传统写法里无参 `pause` 表示「等玩家点击」，本实现只支持定时停顿，所以要等点击请写 `wait` 或补上秒数：

```text
pause 1.5     ← 对
pause         ← 警告：按 0 秒处理
```

这个选择是有意的：不静默丢、也不让整个工程打不开。警告会出现在解析结果里，你会在开发时看到。

## notify

`notify` 发一条浮层提示，不建立等待点——提示飘出来，故事继续往下走：

```text
notify "获得物品：铜钥匙"
```

可以带类型和时长：

```text
notify "任务更新" type="quest" duration=3000
```

`type` 是给宿主分类用的字符串，`duration` 是毫秒。引擎只把它发出去，长什么样、停多久、放哪个角落，都是宿主的事。

文本里的变量插值和 `say` 一样：

```text
notify "金币 +{reward}"
```

## 四个等待点的解除方

| 指令 | 等待态 | 谁来解除 | 宿主调什么 |
| --- | --- | --- | --- |
| `menu` | `menu` | 玩家选中一项 | `engine.choose(目标列)` |
| `input` | `input` | 玩家提交输入 | `engine.input(值)` |
| `wait` | `wait` | 计时器 | 自动；`skipable` 时也可 `engine.advance()` |
| `pause` | `wait` | 计时器 | 自动。不可跳过 |

`menu` 和 `input` 的解除权在宿主——引擎不知道玩家点了哪个选项、输了什么字，得你告诉它。

`wait` 的计时器在引擎里，到点自己走。带 `skipable` 的 `wait` 也能被 `advance()` 提前解除；不带的话 `advance()` 会报「当前 wait 不可跳过（仅 skipable 的 wait 可点击解除）」。

## z 序

`menu` 和 `input` 都能带实例级 z，只影响这一次：

```text
menu "接下来去哪里？" z=20
  "去码头" -> dock
input "名字？" store="player.name" z=20
```

不写就删掉覆盖，回到层默认值。写了非法值（负数、NaN）会报 `instance-z-invalid` 且不动任何状态。

## 下一步

- [op 指令参考 · 交互与小游戏](/reference/ops/interaction/)——`menu` / `input` / `minigame` / `interaction` 的完整参数。
- [op 指令参考 · 对话与叙事](/reference/ops/dialogue/)——`notify` / `wait` / `pause` 的参数表。
- [编写对话与立绘](/guides/dialogue/)——`say` 的行内标记和插值。
