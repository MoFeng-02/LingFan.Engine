---
title: 从模板创建工程
description: 模板提供工程骨架和一个能跑的示例故事。它自带宿主已接的能力有边界，用之前先看清哪些是模板没接、哪些是引擎没有。
---

模板在引擎仓库的 `template/v1/`。`__PROJECT__/` 是工程骨架，`README.md` 是模板自己的说明，`pack-template.ps1` 负责打包，`template-meta.json` 记录模板版本。

## 生成一个新工程

1. 复制 `v1/__PROJECT__/` 到目标位置，重命名为你的工程名。
2. 把目录内所有 `__PROJECT__` 占位符替换成工程名。三处：目录名、`package.json` 的 `name`、`Resources/project.json` 的 `id` 和 `name`。
3. 装依赖（引擎包未发布，先本地链接，见[快速开始](/getting-started/)）。
4. `pnpm dev`。

占位符是整体替换：`__PROJECT__` 出现的地方全都要换成同一个名字。漏掉一处，`package.json` 的名字和清单的 `id` 就对不上。

## 示例故事

`Resources/Stories/title/title_main.story` 是模板自带的示例，它把几件事都演了一遍：

```text
label title_main:
  say "欢迎来到 __PROJECT__。"
  input "先问一句：你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  menu "接下来去哪里？"
    "看舞台元素" -> stage_demo
    "重来一次" -> title_main

scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "scene 列 = 声明式空间层"
  say "进入 scene 列：元素已整体装载。"
  window hide
  say "（对话框已隐藏——点击继续）"
  window show
```

看完可以直接清掉，改成你的故事。

## 模板带了什么

模板自带的宿主不依赖任何 UI 框架，直接操作 DOM。它接了这些：

| 能力 | 状态 |
|---|---|
| 对话层（打字机、`{p}` `{w}` 停顿、样式标记） | 已接 |
| 等待态出口：`menu` / `input` / `wait` / `video` | 已接 |
| 等待态：`minigame` | 已接，但显示「未注册」提示，不伪造完成 |
| 舞台元素层（36 种元素 + 交互 + 12 个表现 op） | 已接，含帧驱动 |
| 层级 z 序（`shell.layers`） | 已接 |
| 存档槽位（`shell.saves.slots`） | 已接 |

## 模板没接什么

这张表里的「没接」都是**模板宿主没写**，不是引擎没有。升级路线见 `apps/playground`——它同时是模板的第一个实例。

| 能力 | 为什么没有 |
|---|---|
| 存档缩略图 | 模板的存档不传截图，存出来就是无缩略图的档。 |
| 历史面板与回溯 UI | 引擎侧接口齐全，模板没做面板。 |
| 玩家偏好面板（音量、文字速度） | 未接时音量取 op 里写的值，打字机速度取故事级 `text_typewriter`。 |
| I18N 供给 | 未接 `i18nPort` 时原文直出。`Lang/` 目录里的译文不会被读。 |
| 对话框模板注册（`say template=`） | 未接时用内建默认骨架。 |
| 屏幕方向锁定（`shell.orientation`） | 纯 Web 没有方向 API，这条只在桌面壳生效。 |
| 资源加密 | 模板宿主装的是静态资源根，直接按路径取文件。加密要平台层解密后再给地址，链路见[加密与平台供给](/concepts/encryption/)。 |
| 热重载 | 靠监视源资源根触发，纯 Web 形态没有文件系统监视。 |
| 宿主信息 | 模板宿主不读运行平台，桌面和移动端走同一套。平台事实只在少数取资源方式上用得到。 |

注意 `minigame` 那一行：模板会显示「未注册」并说明怎么接入，而不是当作成功继续。如果你的故事里有 `minigame`，得自己注册实现。

## 打包分发

```sh
pwsh -File pack-template.ps1 -SourceDir ./__PROJECT__ -OutputFile ./__PROJECT__.zip
```

排除 `node_modules/`、`dist/`、`.git/`、`Resources/Saves/`。后两项是运行期产物，不进模板。

## 模板版本

`template-meta.json` 是模板版本的唯一来源，独立于引擎版本：

```json
{
  "version": "1.1.0",
  "minEngineVersion": "0.1.0",
  "placeholder": "__PROJECT__"
}
```

`minEngineVersion` 是模板要求的最低引擎版本。升级引擎之前先看这个值——模板可能用到了新引擎才有的能力。

## 下一步

- [工程结构](/project-structure/)：每个目录和字段的细节。
- [视觉元素](/concepts/elements/)：示例里那个 `panel` 的完整类型表。
- [扩展引擎](/concepts/extensions/)：往引擎里加自己的 op。
