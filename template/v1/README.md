# 灵泛工程脚手架 v1

**引擎服务 = 核心（框架无关）+ 脚手架（工程骨架）**。本目录是脚手架本体：
新工程由它生成，因此「选什么展示框架」只影响本模板内的宿主代码，**不影响引擎底层**。

模板自带的宿主**不依赖任何 UI 框架**（直接操作 DOM）——这既是「框架无关」的活证明，也让模板保持精简。
但**精简的底线是「不卡死」**：引擎能进入的每一个等待态，模板都必须给出可推进的出口，
并且 `project.json` 的 `shell.*` 配置必须被真正消费（否则作者改了配置却毫无效果）。

### 覆盖范围 / 有意不做（边界表）

| 能力                                            | 模板                   | 说明                                                                            |
| ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| 对话层（打字机 + 内联标记）                     | 是                     | `{p}/{w}` 停顿、样式标记零宽由 `@lingfan-engine/ui` 提供                        |
| 等待态出口：`menu` / `input` / `wait` / `video` | 是                     | 缺任何一个，含该命令的故事都会**永久停滞**                                      |
| 等待态：`minigame`                              | 是（可见 fail-closed） | 模板不接注册表 → 显示「未注册」并说明接入方式，**不伪造完成**                   |
| 舞台元素层（36 类型 + 交互 + 12 个表现 op）     | 是                     | 含 `animate`/`transition`/`shake` 的帧驱动（不驱动会让动画队列只增不减）        |
| 层级（z 序，`shell.layers`）                    | 是                     | 各层 z 由 `resolveLayerZ` 解析后内联写入                                        |
| 存档（`shell.saves.slots` 槽位数）              | 是                     | 存/读为命令面；缩略图**不做**（见下行）                                         |
| 存档缩略图（`shell.saves.thumbnail`）           | 否                     | 合成卡见 `apps/playground`；不传 `screenshot` 即为无缩略图存档                  |
| 舞台适配（`shell.stage`）                       | 否                     | 模板按固定视口布局；要接就取 `resolveStageConfig` 结果再算 `computeStageLayout` |
| 游玩界面禁选文本                                | 是                     | `body` 上 `user-select: none`；要提供复制就给部件加 `data-lf-selectable`        |
| 历史面板与回溯 UI                               | 否                     | 引擎已具备（`historyView`/`rollbackTo`/`back`/`forward`），UI 见 playground     |
| 玩家偏好（音量/文字速度面板）                   | 是                     | `src/host/panels/preferences.ts`，槽位 `#prefs` 可选；未接线 = 音量为 op 值     |
| 界面列交给整屏页面渲染                          | 是（示范一页）         | `src/host/pages/**` + 槽位 `#page` 可选；未注册的列回落按 op 渲染               |
| I18N 供给（`Lang/{lang}/` 覆盖）                | 否                     | 未接 `i18nPort` = 原文直出（引擎契约缺省语义）                                  |
| 对话框模板注册（`say template=`）               | 否                     | 未接 = 内建默认骨架                                                             |
| 屏幕方向锁定（`shell.orientation`）             | 不适用                 | **纯 Web 形态没有方向 API**；该配置只在 Tauri 壳（playground）生效              |
| 资源加密 / 热重载 / 宿主信息                    | 不适用                 | 都是 Tauri 壳能力，见 playground 的组合根                                       |

> 「否」行均指**模板宿主未接**，不代表引擎没有该能力——引擎能力面以 `apps/playground` 为准
> （历史面板 / 玩家偏好 / I18N / 对话框模板在引擎侧均已具备，仅模板未接线）。

> 想升级为全功能实现，看引擎仓库的 `apps/playground`（它同时是模板的第一个实例）：
> 把 `src/main.ts` 换成 Vue/React/原生任意一种都行——**引擎与适配器零改动**。

## 生成一个新工程

```
npm create @lingfan-engine my-story
pnpm create @lingfan-engine my-story
```

生成器会问四件事：工程名、框架、故事源形态、壳。当前框架可选「原生（框架无关）」「Vue 3」「React」，
故事源形态可选「故事文件（`.story`）」与「TypeScript 源（`Stories.src/`）」，
壳可选「浏览器」「小程序（UniApp）」与「桌面（Tauri 2）」。全部取缺省值（原生 + 故事文件 + 浏览器）可以跳过问答：

```
npm create @lingfan-engine my-story -- --yes
```

生成后按提示 `cd my-story && pnpm install && pnpm dev`。选了 TypeScript 源形态的，
`pnpm dev` 之前先跑一次 `pnpm stories:build`（模板已带产物，改过源之后才需要）。

想不开交互问答、直接指定框架与壳：

```
npm create @lingfan-engine my-story -- --framework vue --shell browser
npm create @lingfan-engine my-story -- --framework react --shell browser
npm create @lingfan-engine my-story -- --shell miniprogram
npm create @lingfan-engine my-story -- --framework vue --shell tauri
npm create @lingfan-engine my-story -- --sources ts
```

**框架层只换页面结构与入口，`src/host/**`（装配、订阅、帧循环、输入映射）一行不改，
样式表仍是同一份 `src/styles/stage.css`**，所以换框架不影响游玩界面的外观口径，
也不影响引擎与适配器——它们不认识任何 UI 框架。选 Vue 3 是 `index.html` 换成挂载点、
加 `src/App.vue` 与 Vue 版组合根；选 React 是同一套做法换成 `src/App.tsx` 与 React 版组合根，
外加 `tsconfig.json` 的 `jsx: react-jsx`。

壳层与框架层可以叠加（先框架后壳）：`--framework react --shell tauri` 得到 React 页面 + 桌面外壳。
小程序是例外——它自带 Vue 页面层，不与其他框架层叠加。

**故事源形态层与框架层、壳层正交**，只决定故事从哪来：缺省形态直接改 `Resources/Stories/**/*.story`；
`ts` 形态改 `Stories.src/**/*.ts` 再跑构建，产物是 `Resources/Stories/**/*.json`。后者会删掉骨架那份
手写故事（层里声明 `create.remove: ["Resources/Stories"]`），再补上开箱可跑的生成物与三条脚本
（`stories:build` / `stories:watch` / `stories-typecheck`）。产物目录由构建**全量管理**——源里没有的列
构建会当陈旧列删掉，所以别在产物目录里手改；类型检查走独立的 `tsconfig.stories.json`（故事源有 ambient
全局，不该和页面 DOM 类型面混在一个工程里）。

**壳层是换一整套页面与宿主**：小程序形态的页面结构由 `src/components/**` 承接，宿主装配在
`src/mp/**`（`uni.*` 只在 `src/mp/platform.ts` 出现一处），内容不进包体、走工程接口按基址取。
因此它是壳而不是框架，与 `--framework` 不叠加：小程序已自带 Vue 页面层，框架取缺省值即可。
它的 `vite` 与 `vue` 是一组钉住的版本（UniApp 插件对这些版本有硬约束），由
`package.patch.json` 的 `create.pinned` 保住，不会被改写成「跟最新」。

工程名只允许小写字母、数字、`-` 与 `_`，且不能以下划线或点开头——它同时进 `package.json` 的 `name`、
`project.json` 的 `id` 与目录名，大写与点开头在 npm 侧非法。

引擎包版本由生成器在**生成时**查一次 registry，把当时的最新版本写成 `^x.y.z` 记进产物。
不写 `latest` 标签是因为它每次安装都解析到当时最高版，同一份工程在两台机器上会装出不同版本。

## 依赖接入（引擎包）

模板依赖三个引擎包：`@lingfan-engine/core`（核心）、`@lingfan-engine/adapters`（预设适配器）、`@lingfan-engine/ui`（参考展示层）。
它们以 **TS 源码出口**（`exports: "./src/index.ts"`）发布——消费方由 Vite/TS 直接编译，**无中间构建步骤**，
`pnpm install` 直接可用。选了 TypeScript 源形态的工程会多两个创作期依赖
（`@lingfan-engine/stories-build` 与 `@lingfan-engine/editor`），由 `ts` 层自己声明。

## 工程结构（单资源根）

```
__PROJECT__/
├── project.json          # 工程清单：id/name/entry/lang/formatVersion
├── package.json
├── pnpm-workspace.yaml   # 只声明 allowBuilds：pnpm 12 起「未批准的构建脚本」是硬错误
├── tsconfig.json         # 浏览器侧：src/ 下的 ts 与 vue
├── tsconfig.node.json    # Node 侧：vite.config.ts 与 vite.plugins.ts（要 node:fs 与 @types/node）
├── vite.config.ts        # publicDir: "Resources" ← 资源根即静态根
├── vite.plugins.ts       # 构建期扫描：故事清单与字体清单（虚拟模块，层只换插件数组）
├── index.html            # RenderTargets 落地：stage/dialogue/choices/notifications/toolbar（+ 可选 #prefs / #page）
├── src/main.ts           # 组合根：装配适配器 → 组装工程 → 建引擎 → 订阅渲染 + 帧驱动
├── src/stories.ts        # 故事清单出口（转发 virtual:story-list；清单本身来自磁盘扫描）
├── src/host/             # 宿主：装配、订阅、帧循环、输入映射、页面与面板（不认识 UI 框架）
│   ├── pages/            #   整屏页面：registry / mount / hud / title-page
│   └── panels/           #   玩家偏好面板（音量、静音、文字速度）
├── src/styles/stage.css  # 页面与层样式（换框架不动这份：叠加层共用同一张表）
└── Resources/            # 故事工程根（自包含、可整体搬运）
    ├── project.json      #   工程清单：id/name/entry/lang/formatVersion
    ├── Stories/          #   故事（JSON v1 / .story 混存合法）
    ├── Audio/  Images/  Video/
    ├── Lang/{lang}/      #   I18N overlay
    └── Saves/            #   运行期产物（不入 git）
```

**清单在资源根内**（不是项目根）：只有 `Resources/` 内的文件才会进打包产物，dev 与 prod 因此走同一机制——
清单若留在项目根，dev 下 Vite 顺带服务根目录能取到，打包产物里却会 404。

故事里的资源路径**相对 `Resources/`**：`bgm "Audio/main.mp3"`、`video "Video/op.mp4"`。

## 界面列与页面

`type=ui` 的列不进历史、不进存档、不建检查点——它是界面，不是剧情。这类列可以按 op 画，也可以交给
一个整屏页面去画（Vue / React / 原生 DOM 都行）。

页面注册表在宿主里（`src/host/pages/registry.ts`），键是**列 id**，不是列的类型：引擎进到某一列，
宿主就把那一列注册过的页面挂上去；没注册的列照常按 op 渲染——没有自定义界面是合理降级，不算错。
骨架开箱注册了一个示范页（`src/host/pages/title-page.ts`，故事侧的 `title_main` 列）。

两条硬边界：

- **读走 `StateReader`，写走命令面**（`navigate` / `choose` / `input` / `save` / `load`）。页面不碰状态键，
  也不自己造存档格式——绕过去就等于绕过了保留键守卫与快照一致性。
- **切走即真销毁**。页面切换是完整界面替换：Vue 调 `app.unmount()`、React 调 `root.unmount()`、
  原生清空容器并解绑监听器。**卸载逻辑归宿主写，引擎不管也不检测。**

HUD 是另一类（`src/host/pages/hud.ts`）：它挂在游戏画面之上、可隐藏但**不卸载**，因为玩家随时会再打开，
重建会丢滚动位置与展开状态。`#page` 与 `#prefs` 都是**可选槽位**：不给就是整列按 op 渲染，不报错。

## 打包分发

```
pwsh -File pack-template.ps1 -SourceDir ./__PROJECT__ -OutputFile ./__PROJECT__.zip
```

排除 `node_modules/`、`dist/`、`.git/`、`Resources/Saves/`（运行期产物不进模板）。

打包脚本是给「不走生成器、只想把骨架拿走」的场景准备的。正常路径是 `npm create @lingfan-engine`。

## 叠加层与占位符

`template-meta.json` 的 `frameworks` / `sources` / `shells` 声明生成器会问哪些选项，每项的 `id` 对应
`overlays/<id>/` 目录：同路径文件**覆盖**骨架，根目录的 `*.patch.json` **深合并**进 `package.json`，
其中 `create.remove` 列出本层要删掉的骨架路径（换形态时清残留）。缺省项（`none` / `story` / `browser`）
没有目录，表示「这一层什么都不加」，不是错误。合并顺序固定为「骨架 → 框架 → 故事源 → 壳」：
故事源要晚于框架层才能把各框架入口的故事表指向生成物；壳放最后，因为它对工程形态有最终发言权。

骨架里的占位符有两种大小写形态：`__PROJECT__`（清单 id/name、页面标题、目录名）与
`__project__`（`package.json` 的 name，npm 要求小写）。生成时两者都替换成工程名。

`.gitignore` 在模板里存成不带点的 `gitignore`：npm 把包装进 `node_modules` 时会把包内的
`.gitignore` 改名成 `.npmignore`，模板若按原名存，生成的工程就会既缺忽略规则又多个无用文件。

## 版本

`template-meta.json` 是模板版本的唯一来源（独立于引擎版本）：仅当模板内容真正变化时才 bump。
