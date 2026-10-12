---
title: 工程结构
description: 一个灵泛工程由宿主外壳和 Resources/ 资源根组成。清单、故事、媒体、译文都放在 Resources/ 里，路径一律相对它。
---

一个工程分成两半：外面是宿主外壳（构建配置、HTML、组合根代码），里面是 `Resources/` 资源根（清单、故事、媒体、译文、存档）。

```
my-story/
├── package.json
├── tsconfig.json
├── vite.config.ts        # publicDir: "Resources"
├── index.html            # 舞台 DOM 骨架
├── src/main.ts           # 组合根
└── Resources/            # 资源根
    ├── project.json      # 工程清单
    ├── Stories/
    ├── Audio/
    ├── Images/
    ├── Video/
    ├── Lang/{lang}/
    └── Saves/
```

## 为什么清单在 Resources/ 里

`Resources/` 同时是 Vite 的静态根（`vite.config.ts` 里 `publicDir: "Resources"`）。开发时和打包后，资源都从同一个根取。清单如果留在工程根，开发时 Vite 顺手能读到，打包产物里就 404 了。

同样的原因，故事里的资源路径都相对 `Resources/`：`bgm "Audio/main.mp3"` 对应文件 `Resources/Audio/main.mp3`。路径不带前导斜杠，不能含 `..`，大小写敏感。

## project.json

`Resources/project.json` 是工程的唯一清单，引擎启动时读它。

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "name": "我的故事",
  "entry": "title_main",
  "lang": "zh-CN"
}
```

| 字段            | 必填 | 说明                                                          |
| --------------- | ---- | ------------------------------------------------------------- |
| `formatVersion` | 是   | 固定 `1`。别的值直接拒绝加载。                                |
| `id`            | 是   | 工程标识。写进存档，读档时用来确认存档属于这个工程。          |
| `entry`         | 是   | 入口列 id。引擎从这里开始跑；这个列不存在则整个工程加载失败。 |
| `name`          | 否   | 显示名。缺省时用 `id`。                                       |
| `lang`          | 否   | 默认语言，缺省 `zh-CN`。I18N 覆盖层按它找译文。               |

四个字段之外还有几个可选项，用得少，需要时再看：

| 字段                    | 说明                                                                         |
| ----------------------- | ---------------------------------------------------------------------------- |
| `shell.layers`          | 九个层的 z 序覆盖，如 `{"dialogue": 999}`。                                  |
| `shell.saves.slots`     | 存档槽位数，1 到 32，缺省 6。                                                |
| `shell.saves.thumbnail` | 缩略图尺寸与质量。                                                           |
| `shell.orientation`     | `auto` / `portrait` / `landscape`。纯 Web 宿主没有方向 API，只有桌面壳生效。 |
| `extensions`            | 宿主模块说明符列表，如 `["ext/demo.ts"]`。                                   |
| `defines`               | 全局初始值。故事文件里的同名定义会覆盖它。                                   |
| `resourceEncryption`    | 置 `true` 时资源根是 `.enc` 加密包。清单本身始终明文。                       |

## Stories/

故事文件。两种形态可以混着放：

- `.json` JSON v1——`.story` 编译后的产物是它，TS 创作模式的编译产物也是它；引擎和编辑器读的只有它。
- `.story` 文本文件——手写 DSL，由工具编译成 `.json`。

在 `Stories/` 里放哪儿都行，子目录随意，列 id 在整个工程内唯一。文件名和列 id 无关，撞车由列 id 判重。

新文件怎么进故事清单，按宿主形态分两种：

- **模板宿主（纯 Web 形态）**：按 `src/main.ts` 里 `STORIES` 数组显式取文件，新文件要追加进去：

  ```ts
  const STORIES = ["Stories/title/title_main.story"];
  ```

- **桌面壳**：递归收集 `Resources/Stories/` 下所有故事文件，放了就认，不需要登记；子目录就是章节分组。

引擎侧两种形态一致：组装器只处理 `Stories/` 下的文件，其余路径一律跳过。没进清单的文件（Web 形态漏登记），它的列等于不存在，跳过去就是「目标列不存在」的加载失败。

用 TS 创作模式写的工程，产物落在这里，路径镜像 `Stories.src/` 的源文件路径。这种工程由构建期全量管理列集：源里没有的列会从产物目录删掉。编辑器对这类工程只读，改列请在源里改。判据是工程根有没有 `Stories.src/config.ts`，与 `Stories/` 里当前的文件无关，见 [TS 创作模式](/advanced/ts-story-source/)。

## Audio/ Images/ Video/

媒体文件。分类是约定不是强制——放 `Audio/` 里的图片也能加载，只是路径写成 `Audio/pic.png`。按类型分目录是为了你自己好找。

## Lang/{lang}/

译文覆盖层。`Lang/en-US/` 下的 JSON 文件按「原文 → 译文」覆盖界面文本：

```text
Resources/Lang/en-US/main.json
```

```json
{
  "欢迎来到我的故事。": "Welcome to my story."
}
```

没接 I18N 供给层时，译文不会被加载，原文直接显示。

## Saves/

运行期产物。存档写在浏览器本地存储或宿主自己的位置，`Saves/` 目录只是给桌面壳和文件系统存档留的位置。它不该进版本控制，模板的 `.gitignore` 和打包脚本都排除了它。

## 宿主外壳

`index.html` 是舞台骨架：`#stage`、`#dialogue`、`#choices`、`#notifications`、`#toolbar` 这些容器。`src/main.ts` 是组合根，按固定顺序做四件事：装配适配器、加载并组装工程、建引擎、订阅渲染和帧驱动。

顺序有依赖：层级的 z 序要先解析再写进 DOM，视频层要拿到 z 序才能建，槽位要在建引擎前填好。改宿主时照这个顺序来。

宿主不依赖任何 UI 框架，直接操作 DOM。换 Vue 或 React 只需要改 `src/main.ts` 和 `index.html`，引擎和适配器不用动。

## 下一步

- [从模板创建工程](/from-template/)：占位符替换、打包、模板的边界。
- [故事与叙事流](/concepts/story/)：列和命令怎么组织。
- [多语言故事](/concepts/i18n/)：`Lang/` 的完整规则。
