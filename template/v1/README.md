# 灵泛工程脚手架 v1

**引擎服务 = 核心（框架无关）+ 脚手架（工程骨架）**。本目录是脚手架本体：
新工程由它生成，因此「选什么展示框架」只影响本模板内的宿主代码，**不影响引擎底层**。

模板自带的宿主**不依赖任何 UI 框架**（直接操作 DOM）——这既是「框架无关」的活证明，也让模板保持精简。
但**精简的底线是「不卡死」**：引擎能进入的每一个等待态，模板都必须给出可推进的出口，
并且 `project.json` 的 `shell.*` 配置必须被真正消费（否则作者改了配置却毫无效果）。

### 覆盖范围 / 有意不做（边界表）

| 能力 | 模板 | 说明 |
|---|---|---|
| 对话层（打字机 + 内联标记） | ✅ | `{p}/{w}` 停顿、样式标记零宽由 `@lingfan/ui` 提供 |
| 等待态出口：`menu` / `input` / `wait` / `video` | ✅ | 缺任何一个，含该命令的故事都会**永久停滞** |
| 等待态：`minigame` | ✅（可见 fail-closed） | 模板不接注册表 → 显示「未注册」并说明接入方式，**不伪造完成**（D5） |
| 舞台元素层（36 类型 + F6 交互 + 12 个表现 op） | ✅ | 含 `animate`/`transition`/`shake` 的帧驱动（不驱动会让动画队列只增不减） |
| 层级（z 序，`shell.layers`） | ✅ | 各层 z 由 `resolveLayerZ` 解析后内联写入 |
| 存档（`shell.saves.slots` 槽位数） | ✅ | 存/读为命令面；缩略图**不做**（见下行） |
| 存档缩略图（`shell.saves.thumbnail`） | ⛔ | 合成卡见 `apps/playground`；不传 `screenshot` 即为无缩略图存档 |
| 历史面板与回溯 UI | ⛔ | 引擎已具备（`historyView`/`rollbackTo`/`back`/`forward`），UI 见 playground |
| 玩家偏好（音量/文字速度面板） | ⛔ | 未接 = 音量为 op 值、打字机取故事级 `text_typewriter` |
| I18N 供给（`Lang/{lang}/` 覆盖） | ⛔ | 未接 `i18nPort` = 原文直出（引擎契约缺省语义） |
| 对话框模板注册（`say template=`） | ⛔ | 未接 = 内建默认骨架 |
| 屏幕方向锁定（`shell.orientation`） | ⛔ N/A | **纯 Web 形态没有方向 API**；该配置只在 Tauri 壳（playground）生效 |
| 资源加密 / 热重载 / 宿主信息 | ⛔ N/A | 都是 Tauri 壳能力，见 playground 的组合根 |

> ⛔ 行均指**模板宿主未接**，不代表引擎没有该能力——引擎能力面以规约与 `apps/playground` 为准
> （逐行核对于 2026-09-27：历史面板 / 玩家偏好 / I18N / 对话框模板在引擎侧均已具备，仅模板未接线）。

> 想升级为全功能实现，看引擎仓库的 `apps/playground`（它同时是模板的第一个实例）：
> 把 `src/main.ts` 换成 Vue/React/原生任意一种都行——**引擎与适配器零改动**。

## 生成一个新工程

1. 复制 `v1/__PROJECT__/` 到目标位置，重命名为你的工程名
2. 把目录内所有 `__PROJECT__` 占位符替换为工程名（目录名、`package.json` 的 `name`、`project.json` 的 `id`/`name`）
3. `pnpm install`
4. `pnpm dev` → 打开提示的地址，点击/空格推进对话

## 依赖接入（引擎包）

模板依赖三个引擎包：`@lingfan/engine`（核心）、`@lingfan/adapters`（预设适配器）、`@lingfan/ui`（参考展示层）。
它们以 **TS 源码出口**（`exports: "./src/index.ts"`）发布——消费方由 Vite/TS 直接编译，**无中间构建步骤**。

- 已发布到 registry：`pnpm install` 直接可用
- 尚未发布（**现状，截至模板 1.1.x；是否发布 registry 待定**）：用本地链接指向引擎仓库的包目录

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
├── index.html            # RenderTargets 落地：stage/dialogue/choices/notifications/toolbar
├── src/main.ts           # 组合根：装配适配器 → 组装工程 → 建引擎 → 订阅渲染 + 帧驱动
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
