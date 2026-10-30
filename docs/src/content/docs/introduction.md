---
title: 简介
description: 灵泛引擎 LingFan Engine 是框架无关的 TypeScript 叙事引擎。故事写成文本文件，引擎负责推进剧情、记录状态、存档与回溯，界面由你决定。
---

灵泛引擎 LingFan Engine 是框架无关的 TypeScript 叙事引擎。故事写成文本文件，引擎负责把它跑起来：推进剧情、记录状态、存档、回溯。界面不归引擎管——同一个故事换一套渲染层照样跑，故事和引擎都不用改。

## 一个故事文件

`Resources/Stories/title/title_main.story`：

```text
label title_main:
  say "欢迎来到我的故事。"
  input "你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  menu "接下来做什么？"
    "出发" -> chapter_one
    "再来一遍" -> title_main

label chapter_one:
  say "第一章开始了。"
```

`label` 开一列，列里按顺序写命令。`say` 显示一句话；`input` 停下来等玩家输入，存进 `player.name`；`menu` 给出选项，跳到别的列。这段代码放进模板工程就能跑。

## 引擎做什么

按顺序执行命令，遇到**等待点**停下来等玩家。对话、选项、输入、过场视频、小游戏都是等待点。玩家操作之后从原地继续。

`set`、`array`、`dict` 写下的变量跟着存档和回溯一起走。读档不是把剧情倒回去重放，而是恢复到存档时的坐标和状态。

存档存的是「坐标 + 状态」，不是整段剧情文本。回溯回到之前任意一个对话点，历史面板读的就是这份数据。

译文按 `Lang/{lang}/` 放，缺译时回退原文。

## 引擎不做什么

界面、排版、动画曲线、存档面板、设置页都是展示层的事。引擎给出状态和事件，怎么画由你决定。模板自带的宿主直接操作 DOM，不依赖任何 UI 框架；换成 Vue 或 React 只需要改宿主那几个文件。

引擎不绑定编辑器。故事是纯文本，用顺手的编辑器写就行。仓库里另外带了一个编辑器应用（`pnpm editor`），走工程资源管理器的路子，仍在演进。

## 三层

| 层     | 包                         | 干什么                               |
| ------ | -------------------------- | ------------------------------------ |
| 核心   | `@lingfan-engine/core`     | 解析故事、执行命令、状态、存档与回溯 |
| 适配器 | `@lingfan-engine/adapters` | 音频、视频、资源、存档的预设实现     |
| 展示层 | `@lingfan-engine/ui`       | 对话框、选项、元素渲染的参考实现     |

上表三个包之外，仓库还发四个包：`@lingfan-engine/shell`（宿主编排：提示条、事件落点、面板数据、叙事状态投影）、`@lingfan-engine/editor`（作者层：op schema 单一事实源、词函数子语言、编辑期诊断）、`@lingfan-engine/stories-build`（把 `src/Stories.src/` 的 TS 源编译成故事文件）、`@lingfan-engine/create`（工程生成器：从模板骨架生成新工程，可选框架、故事源与壳）。七个包都在 registry 上，一律以 TypeScript 源码出口发布（`exports: "./src/index.ts"`），由 Vite/TS 直接编译，没有中间构建步骤（见[模板与包边界](/reference/template-boundaries/)）。

## 下一步

- [快速开始](/getting-started/)：从模板跑起一个能玩的故事。
- [工程结构](/project-structure/)：`Resources/` 里放什么，`project.json` 怎么配。
- [故事与叙事流](/concepts/story/)：列、命令、跳转的完整规则。
