# LingFan.Engine · 灵泛叙事引擎

框架无关的 TypeScript 叙事引擎：**核心管叙事语义，Rust 管安全与平台，展示层只是适配器**。

引擎本体不含任何资源，也不假设资源放在哪里——它只预制核心状态与可复用能力（端口契约 + 适配器预设）。

## 三层分工

| 层      | 管什么                                                        | 位置                                          |
| ------- | ------------------------------------------------------------- | --------------------------------------------- |
| Rust    | 安全、平台、文件读写。WebView 里没有 Node，文件与进程操作走它 | `apps/playground/src-tauri/`                  |
| TS 核心 | 叙事语义：故事格式、指令执行、回溯、作用域、存档编排          | `packages/core/`                              |
| 展示层  | 渲染：订阅状态变化 + rAF 帧循环                               | `packages/ui/`、`apps/playground/src/App.vue` |

这三行是硬边界：核心层禁止 import UI 框架、Tauri API 和 Node 内建模块，由 lint 规则强制。

参考宿主目前用 Vue 3 + Vite + Tauri 2 装配。换框架只动 `apps/playground` 与脚手架模板，`packages/core` 一行不改。

## 仓库结构（pnpm workspace）

```
packages/
├── core/         @lingfan-engine/core       框架无关核心（零资源、零运行时依赖）
│   └── src/{contracts, data, runtime, shared}   契约 / 数据层 / 执行层
├── adapters/     @lingfan-engine/adapters   预设适配器：存档、资源、媒体、宿主信息
├── ui/           @lingfan-engine/ui         参考展示层：对话、音频、视频等可测纯逻辑
├── shell/        @lingfan-engine/shell      宿主编排：平台无关的装配逻辑与叙事状态投影
├── editor/       @lingfan-engine/editor     编辑器核心：op schema、编辑期诊断、故事树映射
└── stories-build/@lingfan-engine/stories-build  创作链编译：Stories.src → Resources/Stories
apps/
├── playground/   @lingfan-engine/playground 参考宿主（Vue 3 + Tauri 2）= 模板的第一个实例
└── editor/       @lingfan-engine/editor-app 编辑器界面：时间线、属性面板、诊断、JSON 视图
template/v1/                          脚手架：新工程骨架，含最小可跑宿主
tests/                                集中测试：按「包 → 功能域」归类，不与源码混放
docs/                                 文档站源码（Astro + Starlight，中英双语）
```

**零构建步骤**：三个引擎包以 TS 源码出口（`exports: "./src/index.ts"`）被消费方直接编译——`pnpm dev` 即时生效，包间不需要 `tsc -w`，也没有中间产物目录。

**Desktop + Mobile**：Tauri 2 双端共用同一组端口契约（invoke / 资源协议跨端一致），原生实现与 Web 实现由组合根按构建模式（`--mode tauri`）装配。

## 工程结构：清单 + 单资源根

新工程由 `template/v1` 生成，结构长这样：

```
我的工程/
├── index.html
├── vite.config.ts        # publicDir: "Resources"
├── src/main.ts           # 组合根：装配适配器 → 组装工程 → 建引擎 → 挂载展示层
└── Resources/            # 工程资源根：自包含，可整体搬走
    ├── project.json      # 清单：formatVersion / id / name / entry / lang
    ├── Stories/          # 故事（JSON v1 与 .story 混存）
    ├── Audio/ Images/ Video/
    ├── Lang/{lang}/      # 译文覆盖表
    └── Saves/            # 运行期产物，不入版本库
```

清单必须放在 `Resources/` 里，不能放工程根。只有资源根内的文件才会进打包产物——放根目录的话，`pnpm dev` 能取到，打包后 404。

故事里的资源路径相对 `Resources/`：`bgm "Audio/main.mp3"`、`video "Video/op.mp4"`，不依赖进程工作目录。

## 文档

文档站在 `docs/`，中文在根路径、英文在 `/en/`（英文缺页时自动回退显示中文原文）。本地起来看：

```bash
cd docs && pnpm install && pnpm dev   # http://localhost:4321
```

内容源码也在仓库里：[docs/](https://github.com/MoFeng-02/LingFan.Engine/tree/main/docs)。

## 命令（在仓库根执行）

```bash
pnpm install    # 装依赖
pnpm dev        # 参考宿主（Vite），默认 http://localhost:1420
pnpm tauri dev  # 参考宿主桌面壳（Tauri）
pnpm test:unit  # Vitest，跨包一次跑完
pnpm lint       # ESLint（含核心层框架无关边界规则）
pnpm typecheck  # vue-tsc，整个 workspace 一次检查
pnpm format     # Prettier
pnpm editor     # 编辑器界面（Vite，默认 http://localhost:1425）
```

`pnpm build` 与 `tauri build` 用于打包。iOS 侧的编译与模拟器冒烟由 GitHub Actions 在 macOS runner 上跑。

## 许可

本仓库全部代码以 Apache-2.0 许可发布，全文见根目录 `LICENSE`；`packages/` 下每个包各带一份副本，随包分发时自带许可声明。

对外发布的是 `@lingfan-engine/core`、`@lingfan-engine/adapters`、`@lingfan-engine/ui`、`@lingfan-engine/shell` 四个包。`@lingfan-engine/editor` 为内部依赖（构建期使用，不单独发布），两个应用与脚手架模板不单独声明许可。
