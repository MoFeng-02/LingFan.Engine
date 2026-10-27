---
title: 工程清单 project.json
description: 清单字段逐条说明：formatVersion、capabilityVersion、id、entry、lang、shell.layers、shell.saves、shell.stage、shell.orientation、extensions、defines、resourceEncryption。
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
| `capabilityVersion`  | 见下     | 否   | 工具链  |
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

### capabilityVersion

**能力版本**：产出这份产物的创作工具链支持到哪一版作者面。它回答「这份产物是拿多新的工具写出来的」，**不**回答磁盘形状（那是 `formatVersion`）、**不**回答剧情版本（那是故事列的 `version`）、也**不**等于包的 npm 版本。

这个键**由工具链写入**：构建与编辑器保存时自动盖章，值取自引擎导出的常量 `CAPABILITY_VERSION`，由维护者手工单调递增（只增不减，破坏性变化才进位）。它是托管键——**不要手改**，下次写入会就地覆盖成工具链的值。

读取侧**只读不校验**：缺这个键照常打开，不降级、不提示；整数与字符串都合法（新产物是语义化字符串，如 `"0.9.0"`，整数是早期产物的合法形态）。写旧、写错都不会让工程打不开。

四个「版本」各管一件事：

| 名称                | 写在哪                            | 回答什么                             |
| ------------------- | --------------------------------- | ------------------------------------ |
| `capabilityVersion` | `project.json`（工具链写入）      | 作者面能力到哪一版                   |
| `formatVersion`     | 工程 / 故事 / 文本 / 存档四种格式 | 磁盘形状是第几版（解析器认哪种形状） |
| `version`           | 故事列与清单托管键                | 剧情版本，驱动存档迁移               |
| 包版本              | 各 `package.json`                 | npm 分发版本，**与能力版本无关**     |

查能力版本的唯一入口：TS 里 `import { CAPABILITY_VERSION } from "@lingfan-engine/core"`；产物里看 `project.json` 的 `capabilityVersion` 键。

### id

工程标识。写进存档，读档时比对——不匹配报「该存档与当前故事不匹配」。改这个值会让已有存档全部作废。

### entry

入口列 id。引擎从这一列开始跑。这个列不存在报「project.json: 入口列 title_main 不存在（跳转目标必须存在）」。

它必须**真的在某个故事文件里**。声明了 `entry` 但对应的列文件没被交上来，同样打不开——引擎不读文件系统，只组装供给方递过来的那批文件；文件不在 `Stories/` 下（或大小写不符）就不会被扫进来，列等于不存在。

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

壳配置。四个子键：

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
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
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

#### shell.stage

舞台适配：作者按设计基准像素写坐标，宿主把**舞台**（故事画面：元素层与扩展覆盖层）等比缩放套进窗口；宿主的 UI（工具栏、对话面板这些）留在窗口坐标系里按窗口自适应，不跟着缩放。

```json
{
  "shell": {
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
    }
  }
}
```

`width` / `height` 是**设计基准**（作者坐标系的宽高）：面板、元素、字号都照这个坐标系写，换基准就等于整场换坐标系，样式表不用动。取值 160–16384（宽）与 90–16384（高），缺省 1280 × 720。

内置基准八档（横竖屏各四档，枚举见 `@lingfan-engine/shell` 的 `STAGE_BASELINES`）：

| 档位  | 横屏               | 竖屏        |
| ----- | ------------------ | ----------- |
| 720p  | 1280 × 720（缺省） | —           |
| 1080p | 1920 × 1080        | 1080 × 1920 |
| 2K    | 2560 × 1440        | 1440 × 2560 |
| 4K    | 3840 × 2160        | 2160 × 3840 |

低档竖屏另有一档 750 × 1334（设计稿常用）。预设只是编辑器下拉的现成选项，**任意正数尺寸都能填**——不在表里同样可用。

`fit` 四选一：

| 值        | 行为                                       |
| --------- | ------------------------------------------ |
| `contain` | 等比缩放到完整显示，多出的方向留边（缺省） |
| `cover`   | 等比缩放到铺满，超出的部分裁切             |
| `fill`    | 两轴各自拉满（允许变形）                   |
| `none`    | 不缩放，1 倍原样                           |

需要更细的控制时可以再给这几个（都可省）：

- `scaleBy`：`min` / `max` / `width` / `height` / `fill`，或一个正数倍率（0.05–64）。给了就覆盖 `fit` 展开出来的缩放策略。
- `alignX` / `alignY`：`start` / `center` / `end`，留边时往哪边靠，缺省居中。
- `minScale` / `maxScale`：缩放的上下限，各取 0.05–64。两条**同时**声明且 `minScale > maxScale` 时两条一起忽略——只留一条会得到一个必然夹死或永不生效的区间，不如当作没写。

逐项校验，非法的那一项**单独忽略回默认**，不影响其他项（和 `shell.saves` 同一口径）。这些值只影响宿主表现：不进引擎状态、快照与存档。

宿主侧读法只有一条路——引擎解析后取结果，不要自己读清单：

```ts
import { resolveStageConfig } from "@lingfan-engine/core";

const stage = resolveStageConfig(manifest); // 内建缺省 × 工程覆盖
```

拿到之后交给舞台计算件算变换：`@lingfan-engine/shell` 的 `computeStageLayout(视口, stage)` 给出缩放与偏移，`stageTransform(layout)` 给出 CSS `transform` 串。宿主只负责量视口、套样式、听 `resize`——计算里不读平台全局，所以桌面壳、浏览器与小程序共用同一份口径。

套用时要分层：`transform` 只写在舞台根上，UI 挂在舞台之外的兄弟节点里（窗口坐标系）。把 UI 放进舞台根，窗口一变 UI 会被缩放同步放大一遍——等于跟着窗口二次变化。

`project.json shell.stage` 不是所有宿主都必须实现：脚手架自带的宿主是固定视口布局，还没接这一层（见[模板能力边界](/reference/template-boundaries/)）。桌面壳（`apps/playground`）已接。

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
