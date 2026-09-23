# @lingfan/playground — 参考宿主

全功能参考实现，同时是**脚手架模板的第一个实例**（结构、资源根、接线方式与 `template/v1/__PROJECT__` 同构）。
它**不是引擎的一部分**：删掉本目录不影响 `packages/*` 的构建与测试。

| 关注点   | 本宿主                                                      | 模板宿主                     |
| -------- | ----------------------------------------------------------- | ---------------------------- |
| 展示框架 | Vue 3（`App.vue`）                                          | 无框架（直接 DOM，最小可跑） |
| 功能面   | 打字机 / NVL / 历史面板 / 存读档 / 音频四通道 / 键位 / 回溯 | 推进 + 渲染 + 音频接线       |
| 平台壳   | Tauri 2（`src-tauri/`）                                     | 浏览器                       |

## 资源根（08-U7）

```
apps/playground/
└── Resources/             ← 应用资源根（故事里的路径相对这里）
    ├── Audio/             Audio/crickets_night01.mp3、Audio/chest_drawer_open.mp3
    ├── Images/            Images/lingfan.png
    ├── Video/             Video/m1.mp4
    └── Lang/en/           Lang/en/title_main.json（I18N overlay 示例）
```

故事里的写法（**照搬老引擎语义：路径相对资源根，不带 `Resources/` 前缀**）：

```
bgm "Audio/crickets_night01.mp3" volume=0.5
se  "Audio/chest_drawer_open.mp3" volume=0.8
```

宿主把 `Resources` 作为静态根（[vite.config.ts](vite.config.ts) 的 `publicDir`），于是逻辑路径
`Audio/x.mp3` → URL `/Audio/x.mp3`，开发与打包产物一致，**不依赖进程工作目录**。

## 与引擎的边界

| 层                                                                             | 归属             | 说明                                             |
| ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------ |
| [packages/engine](../../packages/engine)                                       | 引擎核心         | 零资源、零路径假设；寻址只经 `ResourcePort` 契约 |
| [packages/adapters](../../packages/adapters)、[packages/ui](../../packages/ui) | 预设（可替换）   | 端口实现与框架无关的可测纯逻辑                   |
| 本目录                                                                         | 参考宿主（可删） | 展示层 + 平台壳；换框架只动这里                  |

## 命令（在仓库根执行）

```
pnpm dev         # = pnpm --filter @lingfan/playground dev
pnpm tauri dev   # = pnpm --filter @lingfan/playground exec tauri dev
```
