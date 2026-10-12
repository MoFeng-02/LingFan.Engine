---
title: 工程清单 project.json
description: 清单字段逐条说明：formatVersion、id、entry、lang、shell.layers、shell.saves、shell.orientation、extensions、defines、resourceEncryption。
---

`Resources/project.json` 是工程的唯一清单。引擎启动时读它，校验不过整个工程打不开。

清单**必须在资源根里**。放在工程根目录时开发能跑、打包后 404，原因见 [工程结构](/project-structure/#为什么清单在-resources-里)。

## 最小清单

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "entry": "title_main"
}
```

三个字段。其余全可省。

## 字段

| 字段                 | 类型     | 必填 | 缺省    |
| -------------------- | -------- | ---- | ------- |
| `formatVersion`      | `1`      | 是   | 无      |
| `id`                 | string   | 是   | 无      |
| `entry`              | string   | 是   | 无      |
| `name`               | string   | 否   | `id`    |
| `lang`               | string   | 否   | `zh-CN` |
| `defines`            | object   | 否   | 空      |
| `shell`              | object   | 否   | 见下    |
| `extensions`         | string[] | 否   | 无扩展  |
| `resourceEncryption` | boolean  | 否   | `false` |

### formatVersion

固定 `1`。写别的值报 `project.json: formatVersion 必须为 1，收到 2`，整个工程拒绝加载。

### id

工程标识。写进存档，读档时比对——不匹配报「该存档与当前故事不匹配」。改这个值会让已有存档全部作废。

### entry

入口列 id。引擎从这一列开始跑。这个列不存在报「project.json: 入口列 title_main 不存在（跳转目标必须存在）」。

它必须**真的在某个故事文件里**。声明了 `entry` 但对应的列文件没被交上来，同样打不开——引擎不读文件系统，只组装供给方递过来的那批文件；按显式清单取文件的宿主漏登记，列就等于不存在。

### name

显示名，界面上用它。缺省时用 `id`。这个值**不参与翻译**，想要英文名得改清单。

### lang

默认语言，缺省 `zh-CN`。它同时是译文查找的兜底语言：`setLanguage("")` 会回到它。

### defines

全局初始值。在故事跑起来之前先写进状态，故事文件里的同名定义会覆盖它。

```json
{
  "defines": { "player.gold": 7, "difficulty": "normal" }
}
```

装载顺序是：清单的 `defines` 最先，然后故事文件按路径码元序，同名后者覆盖前者。所以清单里写的是「默认值」，故事文件里写的是「覆盖」。

### shell

壳配置。三个子键：

```json
{
  "shell": {
    "layers": { "dialogue": 999, "toolbar": 1400 },
    "saves": {
      "slots": 6,
      "thumbnail": {
        "width": 320,
        "height": 180,
        "quality": 0.7,
        "showText": true
      }
    },
    "orientation": "auto"
  }
}
```

#### shell.layers

九个渲染层的 z 序覆盖。层名和缺省值：

| 层              | 缺省 z | 放什么                     |
| --------------- | ------ | -------------------------- |
| `stage`         | 0      | 背景与舞台元素             |
| `video`         | 100    | 视频层。盖住舞台，不盖对话 |
| `dialogue`      | 999    | 对话框                     |
| `choices`       | 1100   | `menu` / `input` 的选项层  |
| `minigame`      | 1200   | 小游戏与玩法系统           |
| `notifications` | 1300   | `notify` 的浮层            |
| `toolbar`       | 1400   | 常驻工具条                 |
| `history`       | 1500   | 历史面板                   |
| `prefs`         | 1500   | 设置面板                   |

缺省值之间留了 100 的间隔，方便插层。`history` 和 `prefs` 同值——它们不会同时开。

取值必须是有限且非负的数字。写 `-1`、`"999"`、`NaN` 都会被**忽略回默认**，不报错。未知的层名同样忽略。

#### shell.saves

```json
{
  "shell": {
    "saves": {
      "slots": 6,
      "thumbnail": {
        "width": 320,
        "height": 180,
        "quality": 0.7,
        "showText": true
      }
    }
  }
}
```

`slots` 是存档槽位数，取值 1 到 32，缺省 6。槽位 id 是 `slot_1` 到 `slot_N`，按这个数生成。越界（0、33、小数）忽略回默认。

`thumbnail` 四项：`width` 80–1280（缺省 320），`height` 45–720（缺省 180），`quality` 0–1（缺省 0.7），`showText` 布尔（缺省 `true`）。逐项校验，非法的那一项单独忽略，不影响其他项。

这些值是**给宿主看的**，引擎自己不用缩略图——它只管把槽位数报出去。缩略图由宿主截屏合成。

#### shell.orientation

`auto` / `portrait` / `landscape` 三选一，缺省 `auto`。写别的值**报错拒绝整个清单**——这是 `shell` 里唯一 fail-closed 的键，其余非法值都是静默忽略。

```text
project.json: shell.orientation 必须为 auto|portrait|landscape，收到 "vertical"
```

优先级是**玩家偏好 > 工程默认 > auto**。玩家在设置里显式选了 `auto`（跟随系统）会盖掉作者设的 `portrait`。

纯 Web 宿主没有方向 API，这个配置只在桌面壳和移动壳里生效。

### extensions

宿主模块说明符列表：

```json
{ "extensions": ["./extensions/demo-quest.ts"] }
```

必须是**非空字符串数组**。写 `[]` 是错的（要么整个省掉，要么给至少一项）。

声明制：没写进这个数组的模块，引擎完全不感知。它不扫目录也不猜——这是为了避免加载任意代码。

细节见 [扩展引擎](/concepts/extensions/)。

### resourceEncryption

置 `true` 时资源根是一个 `.enc` 加密包，引擎按加密形态读取。清单本身**始终明文**——这是判断形态的前提。

这个开关只声明形态，不指定实现。密钥从哪来、密文怎么解，都不归引擎管——引擎要的只是资源端口 `resolve()` 返回一个当前能用的地址。装哪个实现由组合根决定，密钥留在平台层。

所以网页形态也能走这条路：取回密文，在页面里解出明文，造一个临时地址交给 `resolve()`，端口形状和桌面形态一样。只是模板自带的网页宿主没做这件事，它按静态根直读。

三层各管什么，见[加密与平台供给](/concepts/encryption/)。

## 报错原文

清单校验失败时，所有问题一次报全，每条带 `project.json:` 前缀：

```text
project.json: formatVersion 必须为 1，收到 2
project.json: id 必须为非空字符串
project.json: entry 必须为非空字符串（入口列）
project.json: defines 必须为对象
project.json: name 必须为字符串
project.json: lang 必须为字符串
project.json: extensions 必须为非空字符串数组（宿主模块说明符）
project.json: shell 必须为对象
project.json: shell.orientation 必须为 auto|portrait|landscape，收到 "vertical"
```

字段级的问题全部列出来之后才拒绝，不会报一条停一条。改完再加载。

`entry` 的存在性在字段校验之后单独查：

```text
project.json: 入口列 title_main 不存在（跳转目标必须存在）
```

## 没有清单也能打开

资源根里没有 `project.json` 时，引擎会合成一份降级清单，用资源根目录名当 `id`、取路径码元序第一个列当 `entry`，并给出理由：

```text
未找到 project.json，已按列序第一个「title_main」降级打开（保存后清单会落盘）
```

这是给「作者直接摆故事文件」的场景兜底。**只降级缺清单这一种**——清单存在但格式错，照样拒绝。

一个可解析的列都没有时报：

```text
降级打开失败：资源根「my-story」缺少 project.json，且 Stories/ 下没有任何可解析的列 —— 没有可打开的内容
```

没内容可打开的时候，假装能打开是撒谎。

## 下一步

- [Resources 目录约定](/reference/resources-layout/)——每个目录放什么、路径怎么写。
- [存档系统](/concepts/saves/)——`slots` 和槽位 id 的关系。
- [模板能力边界](/reference/template-boundaries/)——模板宿主消费了哪些 `shell.*`。
