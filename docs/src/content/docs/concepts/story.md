---
title: 故事与叙事流
description: 故事由若干列组成，引擎从入口列开始按顺序执行命令，遇到等待点停下等你操作。跳转改变执行位置，回溯改变历史游标。
---

一个故事是若干**列**的集合。引擎从入口列的第一条命令开始执行，一条接一条往下走，遇到**等待点**就停下来等玩家。

## 列

列有两种写法。

`label` 开一列，里面装命令，按顺序执行：

```text
label title_main:
  say "第一句。"
  say "第二句。"
  menu "去哪里？"
    "左边" -> left_path
    "右边" -> right_path
```

`scene` 开一列，里面装**元素**——舞台上一直摆着的东西，不随对话推进消失：

```text
scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "我是元素，不是对话"
  say "进入这一列时元素已经装载好了。"
```

`scene` 列里也能写命令，写在元素后面。元素的完整规则见[视觉元素](/concepts/elements/)。

列 id 在整个工程内唯一，可以跨文件。文件名和列 id 无关，两个文件里出现同名列 id 才是错误。

## 等待点

引擎跑到这些命令会停下来，等玩家动作：

| 命令          | 停下来等什么               |
| ------------- | -------------------------- |
| `say`         | 玩家点击或按空格继续       |
| `menu`        | 玩家选一个选项             |
| `input`       | 玩家输入一段文本           |
| `wait`        | 计时结束，或者玩家点击跳过 |
| `pause`       | 计时结束。不能跳过         |
| `cutscene`    | 视频播完                   |
| `minigame`    | 小游戏返回结果             |
| `interaction` | 交互系统返回结果           |

`video` 不停——它开始播放，故事继续往下走。需要「播完再继续」用 `cutscene`。

`jump`、`navigate`、`call`、`return` 也不停，它们是控制转移：换到别处继续执行。扩展 op 同样不产生等待点。

## 跳转

`jump` 跳到某个列：

```text
  jump chapter_one
```

`navigate` 和 `jump` 一样按列 id 跳，区别是它多一个 `scene` 参数、并且会清掉上一列留下的对话镜像：

```text
  navigate "chapter_one"
  navigate "chapter_two" scene "chapter_one"
```

两个参数都是列 id，不是文件路径——文件在组装时就摊平成列了，运行期没有「文件」这个概念。`scene` 存在时优先于 `path`，上面第二行实际跳到 `chapter_one`。

在列里写 `scene "目标"` 等价于 `navigate "目标"`：

```text
  scene "chapter_one"
```

`call` 跳过去，`return` 回来——用来复用一段公共流程：

```text
label title_main:
  call show_warning
  say "回来了。"

label show_warning:
  say "这是一段警告。"
  return
```

## 列的类型

列默认是剧情列（`game`）：进历史、能存档、到等待点时建检查点。

另外两种类型不参与历史，也不建检查点：

```text
scene pause_menu type=menu
  say "菜单场景。"

scene status_panel type=ui
  say "状态面板。"
```

做标题界面、暂停菜单、状态面板时用它们，这些临时界面就不会写进回溯历史。从剧情列进到这类列时，引擎会记下进入前的进度；在这类列里存档，存下来的是进入前的游戏位置，不是菜单本身。

`type` 只在非默认值时才需要写出来。目前 `menu` 和 `ui` 在引擎里行为一致——需要区分两者的场景还没实现，写哪个都不影响运行。

## 入口列

`Resources/project.json` 的 `entry` 字段指定从哪一列开始：

```json
{
  "entry": "title_main"
}
```

入口列不存在，整个工程加载失败，报「project.json: 入口列 X 不存在（跳转目标必须存在）」。单文件故事如果没指定，默认用第一列。

## 一列怎么结束

列里的命令跑完，如果没有跳转，故事就停在那里。想继续要显式写跳转：

```text
label chapter_one:
  say "第一章结束。"
  jump chapter_two
```

## 下一步

- [状态与变量](/concepts/state/)：命令之间怎么传数据。
- [回溯与历史](/concepts/rollback/)：玩家怎么回到之前的位置。
- [存档系统](/concepts/saves/)：存档里到底存了什么。
