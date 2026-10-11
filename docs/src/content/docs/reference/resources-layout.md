---
title: Resources 目录约定
description: 资源根里每个目录放什么、路径怎么写、大小写与点文件的规则，以及编辑器怎么看待这个目录。
---

`Resources/` 是资源根。清单、故事、媒体、译文、存档都在它里面，故事里写的所有路径都相对它。

```
Resources/
├── project.json
├── Stories/
│   ├── title/title_main.story
│   └── chapter1/chapter1.story
├── Audio/
├── Images/
├── Video/
├── Lang/
│   └── en/main.json
└── Saves/
```

## 每个目录放什么

| 目录 | 放什么 | 引擎怎么读 |
| --- | --- | --- |
| `Stories/` | 故事文件（`.story` / `.json`） | 组装成列，入口由清单的 `entry` 指定 |
| `Audio/` `Images/` `Video/` | 媒体文件 | 不主动扫描，命令里写路径才取 |
| `Lang/` | 译文覆盖层 | 由 I18N 供给端口按语言加载 |
| `Saves/` | 运行期存档产物 | 纯 Web 宿主不用这个目录 |

`Audio/` `Images/` `Video/` 的**分类是约定不是强制**。图片放 `Audio/` 里也能加载，只是路径要写成 `Audio/pic.png`。按类型分目录是为了你自己好找。

`Saves/` 在模板里是给桌面壳和文件系统存档留的位置。浏览器宿主把存档写进本地存储，这个目录就是空的（模板里只有一个 `.gitkeep` 占位）。它不该进版本控制，模板的 `.gitignore` 和打包脚本都排除了它。

## 路径怎么写

故事里所有资源路径**相对 `Resources/`**：

```text
bgm "Audio/main.mp3"
video "Video/op.mp4"
show "Images/ache.png"
background "Images/room.png"
```

四条规则：

**不带前导斜杠**。写 `bgm "/Audio/main.mp3"` 路径会被剥掉前导斜杠——不报错，但别这么写。

**不能含 `..`**。路径按 `/` 切成段，出现空段或 `..` 直接拒绝：

```text
资源路径非法（越出资源根）：../secret.txt
```

**大小写敏感**。`Audio/Main.mp3` 和 `Audio/main.mp3` 是两个文件。开发机上（Windows、macOS 默认）可能都能读到，打包到 Linux 服务器就 404 了。写完检查一遍大小写。

**空格与中文可以用**，但路径里带空格时 URL 编码容易出岔子，建议文件名用英文和连字符。

## 点文件会被跳过

路径里**任何一段**以 `.` 开头，就是点文件，引擎跳过它：

```text
Resources/Live2D/.gitkeep       → 跳过
Resources/Stories/.gitignore    → 跳过
Resources/Lang/en-US/main.json  → 不跳过（名字里有连字符和点，但不是点文件）
```

跳过是因为工程里常见空目录占位文件（`.gitkeep`）。不跳过的话，引擎会把 `.gitkeep` 当成故事文件解析，报「文本中没有 label」，整个工程打不开。

`Lang/en-US/` 这种名字里有 `-` 和 `.` 的**不是**点文件——判据只看段的**开头**是不是 `.`。

## Stories/ 是唯一会被组装的目录

组装工程时**只处理 `Stories/` 下的文件**。其他目录一律跳过。

这条说的是**故事列集的组装**。`Lang/` 下的译文不走这条路——它们由译文供给管线单独读取，不参与组装；桌面壳对 `Lang/` 同样是递归收集（`apps/playground/src-tauri/src/project_files/overlay.rs:112` 的 `load_i18n_overlay`，`:26` 起递归下钻 `.json`），所以译文放在多深的子目录里都不用登记。

这不是优化，是正确性要求：如果 `Lang/en/main.json` 被当成故事文件解析，它没有 `formatVersion` 字段，会让整个工程组装失败。

所以：

- 故事文件放 `Stories/` 下，子目录随意。
- 译文文件放 `Lang/` 下。
- 别把故事文件放在资源根顶层或 `Audio/` 里——引擎根本不会看它。

新故事文件要不要登记，取决于宿主怎么取文件。引擎不读文件系统——它拿到的是供给方交上来的一批文件内容，列举文件是供给方的事。

桌面壳的供给方递归扫 `Stories/`，新增文件不用登记。模板和浏览器形态按一张显式清单逐个取（HTTP 没法列目录），所以要加进 `src/main.ts` 的 `STORIES` 数组：

```ts
const STORIES = [
  "Stories/title/title_main.story",
  "Stories/chapter1/chapter1.story",
];
```

按清单取的形态下，漏登记的后果不是「文件被忽略」这么温和——跳转到那个列会报「目标列不存在」。

## 文件名与列 id

文件名和列 id **没有关系**。`Stories/chapter1/chapter1.story` 里装一个叫 `chapter1_start` 的列完全合法——文件名是章节名，列 id 是场景名，本来就是两回事。

撞车由列 id 判重：两个文件声明同一个 id，报

```text
Stories/chapter2/chapter2.story: columnId 重复：chapter1_start（与 Stories/chapter1/chapter1.story 冲突）
```

改列名的时候注意，跳转目标写的是列 id 不是文件名。

## Lang/ 的两种形态

译文可以放成一个大文件，也可以按语言分目录：

```text
Resources/Lang/en.json                  ← 单文件，文件名就是语言码
Resources/Lang/en/main.json             ← 目录形态，main.json 是兜底
Resources/Lang/en/chapter1.json         ← 同语言的其他文件，按路径序覆盖
```

两种形态都能用，供给端口两种都认。目录形态里 `main.json` 最先合并，其余文件按路径顺序覆盖——所以 `chapter1.json` 里可以覆盖 `main.json` 里的同名键。

译文文件的值**必须全是字符串**。有一个值不是字符串，整个文件作废（不是跳过那一行）。这条规则是为了防止「一半译文生效、一半是原文」这种难查的状态。

细节见 [多语言与译文](/concepts/i18n/)。

## 大小写与编辑器

编辑器的资源对账用的是**枚举出来的真实路径**，和运行期同一口径：文件在 `Resources/` 里叫什么，故事里就得写什么。所以编辑器说「资源路径不存在」时，多半是大小写或者目录写错了。

编辑器有意**不读文件头判断加密**——加密形态的知识在宿主侧，编辑器打开的工程都是明文形态。所以它不会对 `.enc` 后缀做特判。

## 下一步

- [工程清单 project.json](/reference/manifest/)——`entry`、`shell.*`、`defines` 都在这里配。
- [多语言与译文](/concepts/i18n/)——`Lang/` 的完整规则。
- [模板能力边界](/reference/template-boundaries/)——模板宿主接了哪些能力。
