# LingFan.Engine · 灵泛叙事引擎

框架无关的 TypeScript 叙事引擎：**核心管叙事语义，Rust 管安全与平台，展示层只是适配器**。
引擎本体**不包含任何资源**，也不假设资源放在哪里——它只预制核心状态与可复用能力（端口契约 + 适配器预设）。

## 三层分工（不变量）

| 层      | 职责                                             | 位置                                          |
| ------- | ------------------------------------------------ | --------------------------------------------- |
| Rust    | 安全 + 平台 + 文件（WebView 无 Node）            | `apps/playground/src-tauri/`                  |
| TS 核心 | 叙事语义：格式 / 执行 / 回溯 / 作用域 / 存档编排 | `packages/engine/`                            |
| 展示层  | 渲染：订阅 `ValueChanged` + rAF 帧循环           | `packages/ui/`、`apps/playground/src/App.vue` |

当前装配 Vue 3 + Vite + Tauri 2 仅为**易变事实**，非架构承诺——换框架只动 `apps/playground` 与脚手架模板，核心零改动。

## 仓库结构（pnpm workspace）

```
packages/
├── engine/       @lingfan/engine     框架无关核心（零资源、零依赖）
│   └── src/{contracts, data, runtime}   契约 / 01 数据层 / 02-04 执行（禁平铺，按功能域归类）
├── adapters/     @lingfan/adapters   预设适配器：save / resources / media 三域
└── ui/           @lingfan/ui         参考展示层：dialogue / audio 两域（可测纯逻辑）
apps/
└── playground/   @lingfan/playground 参考宿主（Vue 3 + Tauri 2）= 模板的第一个实例
template/v1/                          脚手架：新工程骨架（含最小可跑宿主）
```

**零构建步骤**：三个包以 TS 源码出口（`exports: "./src/index.ts"`）被消费方直接编译——
`pnpm dev` 即时生效，包间无需 `tsc -w` 或产物目录。
**Desktop + Mobile**：Tauri 2 双端共用同一组端口契约（invoke / 资源协议跨端一致），
原生与 Web 实现由组合根按构建模式（`--mode tauri`）装配。

## 交付形态：核心 + 脚手架

新工程由 `template/v1` 生成；工程结构 = `project.json` + `Resources/` 单根
（`Resources/{Stories,Audio,Images,Video,Media,Live2D,Lang/{lang},Saves}`）。
故事里的资源路径**相对 `Resources/`**：`bgm "Audio/main.mp3"`、`video "Video/op.mp4"`（08-U7，不依赖进程工作目录）。

## 文档与规约

- 语义规约（做什么）：`私有文档/新引擎规约/` 00–08（本机文档，不入 git）
- 通用宪法（怎么写）：`.rules.md` / `.rules.ai.md`
- 项目独有规则与现状：`agent.md`

## 命令（在仓库根执行）

```
pnpm dev        # 参考宿主开发（Vite）
pnpm tauri dev  # 参考宿主桌面壳（Tauri）
pnpm lint       # ESLint（含核心层框架无关边界规则）
pnpm format     # Prettier
pnpm test:unit  # Vitest（跨包一次跑完）
pnpm typecheck  # vue-tsc（整个 workspace 一次检查）
```

`pnpm build` / `tauri build` 为打包用途，按项目工具链纪律不由 AI 主动执行。
