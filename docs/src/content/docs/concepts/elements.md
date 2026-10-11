---
title: 舞台元素
description: scene 列里的元素行构成画面：36 种类型、七组，未知类型和未知属性都会被拒绝。元素表是状态的一部分，跟着存档和回溯走。
---

对话框和菜单之外的东西——立绘、面板、按钮、进度条——都写在 `scene` 列里。这类列没有命令流，只有元素表。

```text
scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "左边的箱子"
    text "右边的门"
```

进这个列时元素表装载进状态；离开去 `label` 列（flow）时清空。

## 36 种类型

按用途分七组：

| 组 | 类型 |
|---|---|
| 文本 | `text` `dialog` `narrator` `speaker` |
| 交互 | `button` `choice` `imagebutton` |
| 图像 | `image` `background` `portrait` `video` |
| 容器 | `panel` `frame` `window` `dialogbox` `choicebox` `infobox` `overlay` `popup` `vbox` `hbox` `grid` `stack` `stackpanel` `canvas` `border` |
| 滚动 | `scroll` `scrollviewer` `viewport` |
| 进度 | `bar` `vbar` `progressbar` `slider` `checkbox` |
| 间隔 | `separator` `spacer` |

只有容器类型能带子元素。给 `text` 写嵌套会报「`.children` 仅容器类型可带（text 不是容器：ELEMENT_CONTAINER_TYPES）」。

## 两种写法

裸写类型名就行：

```text
  text "一段文字"
```

但 `video`、`background`、`window` 这三个名字跟命令重名，裸写会被当成命令。要写同名的元素，加 `element` 前缀：

```text
  element window x=0 y=0 width=100% height=100%
```

`element` 后面跟一个不是元素类型的名字，报「element 前缀后不是已知元素类型：xxx」。

嵌套靠缩进，子层只允许元素行：

```text
  vbox spacing=8
    text "第一行"
    text "第二行"
```

子层里写 `say` 这种命令会报「元素内只允许子元素行，不允许命令」。

## 属性和校验

未知类型直接拒绝：

```text
.type 必须是 36 种元素类型之一，收到 "pannel"（未知类型 fail-closed）
```

未知属性也一样：

```text
.text.x 不是合法元素属性（属性全集 = 通用属性 ∪ 元素特定属性，未知 fail-closed）
```

属性表覆盖位置（`x` `y` `margin`）、尺寸（`width` `height` `minWidth` `maxWidth`）、外观（`opacity` `rotation` `scale` `cornerRadius` `borderThickness`）、布局（`spacing` `direction` `columns` `rows` `col` `row` `colspan`）、对齐（`align` `halign`）等。`class` 和 `style` 两个属性把剩下的交给 CSS。

契约里还声明了几个暂时没实现的属性：`xanchor` `yanchor` `xalign` `yalign` `valign` `xoffset` `yoffset` `stretch`。写上去不报错，但也不生效——编辑器不给你这些表单，诊断面板会报「元素属性 xanchor 已声明但当前无渲染语义（写入不生效）」。

`order` 是另一回事：没写 `zindex` 时引擎拿它当叠放依据，见下面的叠放顺序。编辑器的诊断清单目前把它和上面那批放在一起，写 `order` 也会收到同样的 warning——这条是误报。

拼错属性名不会静默忽略——构建时就报错。

## 寻址：id 和 name

两个标识字段分工不同：

```text
  text "血量" id="hp_label"
  text "血条底" name="hud"
  text "血条值" name="hud"
```

`id` 要求唯一，精确命中一个。`name` 可以重复，批量命中全部。

`hide`、`zindex`、`style`、`animate` 这些按目标操作的命令，先用 `id` 找，找不到再用 `name`。两边都没命中就报错（`hide` 例外——它没命中也不报错，可以重复调用）。

`id` 缺省会自动派生 `${列id}#${序号}`，序号是同层声明序。这个值只用来兜底，别依赖它。

## 叠放顺序

`zindex` 最大，其次 `order`，都没有就按声明序：

```text
  panel zindex=10      // 最上面
  image order=5        // 中间
  text "背景文字"       // 按声明位置排
```

数值越小越靠前。`background` 换背景时固定用底层序（-1000）——写进去的那张永远垫底，其余元素都画在它上面。例外是 `show` 追加的图：默认按追加序叠在背景上面，但之后用 `zindex` 写负值（如 `-5000`）会把它压到背景底下，这时反过来是背景盖住它（见[舞台命令](/reference/ops/stage/)）。

## 点击

交互元素（`button` `choice` `imagebutton`）点下去做什么，按这个优先级挑一个：

```text
disabled  >  nav  >  ops  >  cmd
```

- `disabled` 为真就不响应。可以写布尔，也可以写表达式原文：

  ```text
    button "买下" disabled="{player.gold < 10}" cmd="buy"
  ```

  表达式在点击那一刻求值。`enabled=false` 跟 `disabled` 同义。

- `nav` 直接跳列，走引擎的 `navigate`：

  ```text
    button "去下一章" nav="chapter_two"
  ```

- `ops` 是点击时按序执行的命令数组，用 JSON 写：

  ```json
  {
    "type": "button",
    "text": "开门",
    "ops": [{ "op": "set", "key": "door_open", "value": true }]
  }
  ```

- `cmd` 是宿主注册的自定义命令名，命中就交给宿主处理。没注册会报「元素命令未注册：xxx（fail-closed：需宿主经命令注册表提供）」。

`ops` 里不能用这些命令：`say` `menu` `input` `wait` `pause` `nvl` `cutscene` `minigame`（等待类）、`jump` `navigate` `call` `return`（位置类）、`save` `load` `auto_save` `save_delete`（存档类）。写进去整次拒绝，报「元素 ops[0] 的 say 不可用于点击动作（等待/位置/存档类 op 会打断当前叙事流）」。跳列请用 `nav`。

`ops` 只在等待画面上生效——玩家正在看某一屏的时候。命令流跑着的时候点不会触发。执行中任何一条失败，整个序列回滚，状态跟点击前一样。

`hover_*`、`selected_*`、`disabled_*` 这些视觉态跟点击逻辑互不干扰，各绑各的。

## 表现类命令

这 12 个命令改元素表或者触发效果，在任何列都能用：

| 命令 | 做什么 |
|---|---|
| `show "Images/box.png"` | 追加一张图，可带 `x` `y` `id` `name` |
| `hide "hp_label"` | 按 `id`/`name`/资源路径移除 |
| `background "Images/bg.png"` | 换背景，固定底层序 |
| `bg_switch "Images/bg2.png"` | 同上，带切换效果 |
| `zindex "hud" value=20` | 改叠放序 |
| `style "hud" props={opacity: 0.5}` | 改属性，键必须在属性表内 |
| `window hide` / `window show` / `window auto` | 对话框显隐 |
| `animate "hud" property=opacity value=0 duration=0.5` | 单属性动画 |
| `animate_block "hud" x=100 opacity=1 duration=0.4` | 多属性同时动 |
| `transition "fade" duration=0.5` | 全屏过渡 |
| `shake intensity=8 duration=0.3` | 屏幕抖动 |
| `text_typewriter enabled=true speed=40` | 打字机开关与速度 |

`animate` 和 `animate_block` 的核心只记「从哪到哪、多长时间」这一条描述，每帧的中间值由展示层算。播完把终值写回元素属性——所以存档和回溯看到的都是终态，不会存到某个中间帧。

`animate_block` 的多个属性**同时**开始，不是依次。要串行就写多条 `animate`。

`style` 的 `props` 键必须在元素属性表内，写 `props={width2: 100}` 报「style 未知元素属性：width2」。

## 元素文字会被翻译

元素的 `text` 属性在装载时就查译文表，翻好的值进状态容器。所以切换语言后，屏幕上已有的元素文字不变，重新进这个列才更新。细节见[多语言与译文](/concepts/i18n/)。

## 渲染归展示层

引擎只管元素表这个数据结构。画成什么样、认不认某个类型，是展示层的事——模板宿主注册了一套内建渲染器，遇到没注册的类型会报「元素类型未注册：xxx（fail-closed：不伪造渲染）」。自己写展示层的话，这层得自己接。

## 下一步

- [视觉元素之外的状态](/concepts/state/)：元素表也在同一个状态容器里。
- [回溯与历史](/concepts/rollback/)：元素变化怎么跟着回退。
- [多语言与译文](/concepts/i18n/)：元素文字的翻译时机。
