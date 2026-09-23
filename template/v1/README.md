# 灵泛工程脚手架 v1

**引擎服务 = 核心（框架无关）+ 脚手架（工程骨架）**。本目录是脚手架本体：
新工程由它生成，因此「选什么展示框架」只影响本模板内的宿主代码，**不影响引擎底层**。

模板自带的宿主**不依赖任何 UI 框架**（直接操作 DOM）——这既是「框架无关」的活证明，也让模板保持最小。
想要全功能参考实现（打字机细节 / NVL / 历史面板 / 存读档 / 音频四通道 / 键位映射），
看引擎仓库的 `apps/playground`（它同时是模板的第一个实例）。

## 生成一个新工程

1. 复制 `v1/__PROJECT__/` 到目标位置，重命名为你的工程名
2. 把目录内所有 `__PROJECT__` 占位符替换为工程名（目录名、`package.json` 的 `name`、`project.json` 的 `id`/`name`）
3. `pnpm install`
4. `pnpm dev` → 打开提示的地址，点击/空格推进对话

## 依赖接入（引擎包）

模板依赖三个引擎包：`@lingfan/engine`（核心）、`@lingfan/adapters`（预设适配器）、`@lingfan/ui`（参考展示层）。
它们以 **TS 源码出口**（`exports: "./src/index.ts"`）发布——消费方由 Vite/TS 直接编译，**无中间构建步骤**。

- 已发布到 registry：`pnpm install` 直接可用
- 尚未发布（当前状态）：用本地链接指向引擎仓库的包目录

  ```
  pnpm add @lingfan/engine@link:<引擎仓库>/packages/engine \
           @lingfan/adapters@link:<引擎仓库>/packages/adapters \
           @lingfan/ui@link:<引擎仓库>/packages/ui
  ```

## 工程结构（对齐规约 07 §三，与老引擎一致的单根）

```
__PROJECT__/
├── project.json          # 工程清单：id/name/entry/lang/formatVersion
├── package.json
├── tsconfig.json
├── vite.config.ts        # publicDir: "Resources" ← 资源根即静态根（08-U7）
├── index.html            # RenderTargets 最小落地：stage + dialogue
├── src/main.ts           # 组合根：装配适配器 → 组装工程 → 建引擎 → 订阅渲染
└── Resources/            # ★故事工程根（自包含、可整体搬运）
    ├── project.json      #   工程清单：id/name/entry/lang/formatVersion
    ├── Stories/          #   故事（JSON v1 / .story 混存合法）
    ├── Audio/  Images/  Video/
    ├── Lang/{lang}/      #   I18N overlay
    └── Saves/            #   运行期产物（不入 git）
```

**清单在资源根内**（不是项目根）：只有 `Resources/` 内的文件才会进打包产物，dev 与 prod 因此走同一机制——
清单若留在项目根，dev 下 Vite 顺带服务根目录能取到，打包产物里却会 404。

故事里的资源路径**相对 `Resources/`**：`bgm "Audio/main.mp3"`、`video "Video/op.mp4"`。

## 打包分发

```
pwsh -File pack-template.ps1 -SourceDir ./__PROJECT__ -OutputFile ./__PROJECT__.zip
```

排除 `node_modules/`、`dist/`、`.git/`、`Resources/Saves/`（运行期产物不进模板）。

## 版本

`template-meta.json` 是模板版本的唯一来源（独立于引擎版本）：仅当模板内容真正变化时才 bump。
