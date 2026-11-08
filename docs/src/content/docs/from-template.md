---
title: 从模板创建工程
description: 模板提供工程骨架和一个能跑的示例故事。它自带宿主已接的能力有边界，用之前先看清哪些是模板没接、哪些是引擎没有。
---

模板在引擎仓库的 `template/v1/`。`__PROJECT__/` 是工程骨架，`overlays/` 是可叠加层，`README.md` 是模板自己的说明，`pack-template.ps1` 负责打包，`template-meta.json` 记录模板版本与可选项。

## 生成一个新工程

```sh
npm create @lingfan-engine my-story
pnpm create @lingfan-engine my-story
```

生成器问三件事：工程名、描述、形态。工程名写在命令行里就跳过这一问；描述可以留空，填了会同时写进 `package.json` 的 `description` 与 `Resources/project.json` 的 `description`。

形态是一次多选，编号如下：

| 编号 | 形态             | 选中后得到什么                                                   |
| ---- | ---------------- | ---------------------------------------------------------------- |
| 1    | Vue 3            | 页面结构换成单文件组件，装配与宿主不变                           |
| 2    | React            | 页面结构换成 JSX 组件，装配与宿主不变                            |
| 3    | 桌面（Tauri 2）  | 在同一份工程上再加一个桌面壳：存档落到应用数据目录，页面结构不变 |
| 4    | 小程序（UniApp） | 页面层换成 UniApp Vue 3 单文件组件，宿主装配走小程序端口         |

按编号回答，空格或逗号分隔，例如 `1 3`。回车全部跳过，得到骨架原生形态：框架无关 + 浏览器。

组合规则：

- Vue 3 与 React 互斥：页面结构只能有一个所有者。
- 小程序（UniApp）自带 Vue 页面层，与 Vue 3、React、桌面壳互斥。
- 桌面壳叠在浏览器形态之上，与 Vue 3 或 React 组合都可以；单独选它也成立，得到原生页面 + 桌面壳。

这一问只定页面结构与壳，不问故事怎么写。故事有三种创作形态，落在同一棵 `Resources/Stories/` 树上，构建期一起被扫描，**可以混装在一个工程里**：

| 创作形态      | 写在哪                         | 改完怎么生效 |
| ------------- | ------------------------------ | ------------ |
| TS 源         | `src/Stories.src/**/*.ts`      | 跑一次构建   |
| 手写 `.story` | `Resources/Stories/**/*.story` | 保存即生效   |
| 手写 `.json`  | `Resources/Stories/**/*.json`  | 保存即生效   |

三者互不排斥：骨架自带的是 TS 源那一条链（类型补全、重构、复用 TS 生态，构建时编译成 `.json`），而手写的 `.story` 和 `.json` 随时可以往同一个 `Resources/Stories/` 里加，不需要拆掉 TS 链。唯一的硬约束是列 `id` 全工程唯一——不同文件里的列只要 id 不撞，就能共存。

`--sources story`（以及 `--template …-story`）的含义因此是「额外附一份手写 `.story` 示例」，它不改变 TS 创作链的去留。

生成后按提示进目录、装依赖、跑起来。生成器默认不装依赖，想一步到位加 `--install`。

### 脚本与 CI

脚本里不必应答问答：用参数直接把三段都定下来，跳过交互。

```sh
npm create @lingfan-engine my-story --description "试菜单的小工程" --framework vue --shell tauri
```

`--framework` 取 `none` / `vue` / `react`，`--shell` 取 `browser` / `tauri` / `miniprogram`。任一维缺席取该维缺省值，参数模式不做互斥校验——组合由脚本自己负责。`--sources` 取 `ts` / `story`：`story` 额外附一份手写 `.story` 示例，`ts` 就是骨架自带的样子。

`--template` 是同一件事的紧凑写法，写作 `框架[-壳[-故事源]]`：

```sh
npm create @lingfan-engine my-story --template vue-tauri
npm create @lingfan-engine my-story --template react-browser
npm create @lingfan-engine my-story --template none-miniprogram
npm create @lingfan-engine my-story --template none-browser-story
```

形态选择以问答为准，`--template` 留给既有脚本。

全部取缺省值（原生 + 浏览器，故事示例也不额外附带）用 `--yes`，此时不再问任何问题。

> 上面这些示例按 pnpm / bun 的透传行为写。npm 会先按自己的配置项解析开关（`--yes` 就是一个），此时要在第一个选项前加分隔符 `--`：`npm create @lingfan-engine my-story -- --yes`。

框架层只换页面结构与入口：选 Vue 3 把 `index.html` 换成挂载点、加 `src/App.vue` 与 Vue 版组合根，选 React 换成 `src/App.tsx` 与 React 版组合根；两者都不动 `src/host/**`（装配、订阅、帧循环、输入映射）——引擎与适配器不认识任何 UI 框架。两种形态的样式表是同一份 `src/styles/stage.css`。

壳层分两种：桌面壳只补一层桌面外壳，页面结构与宿主原样保留，所以它能叠在 Vue 3 或 React 之上；小程序壳换掉整套页面与宿主，页面结构由 `src/components/**` 承接，宿主装配在 `src/mp/**`（平台 API 只在一处出现），内容不进包体、按基址走工程接口。它的 `vite` 与 `vue` 是一组被 UniApp 插件钉死的版本，由叠加层声明保留，不参与「跟最新」。

故事怎么写与上面那一问无关——三种创作形态的取舍见前面的表，写法细节见 [TS 创作模式](/advanced/ts-story-source/)。混装时有三条通用注意：

- 列 `id` 全工程唯一：不同文件里的列只要 id 不撞，就能共存；撞了会在构建时报出冲突的两个来源。
- 产物目录 `Resources/Stories/**` 里由构建写出的 `.json` 由构建自己维护——构建只清理它上一轮写过、这一轮不再产出的文件，你手写的 `.story` 与 `.json` 它不碰。所以改 TS 源比改它生成的 `.json` 可靠。
- 类型检查走独立的 `tsconfig.stories.json`，与框架层那份 `tsconfig.json` 分开：故事源有 `state` 等 ambient 全局，和页面代码的 DOM 类型面不该混在一个工程里。

工程名只允许小写字母、数字、`-`、`_`，不能以下划线或点开头——它同时进 `package.json` 的 `name`、`Resources/project.json` 的 `id` 与目录名，大写与点开头在 npm 侧非法。

有两件事生成器会替你做，手工复制目录时容易漏：

- **占位符整体替换**：`__PROJECT__` 与 `__project__` 两种形态都换（后者是 `package.json` 的 name，必须小写）。漏一处，包名与清单 `id` 就对不上。
- **引擎包版本取当下最新**：生成时查一次 registry，把最新版写成 `^x.y.z`。不写 `latest` 标签，是因为它每次安装都解析到当时最高版，同一份工程在两台机器上会装出不同版本。少数上游还不兼容的包（当前是 `typescript`——`vue-tsc` 在 7 上会崩）由叠加层声明保留模板记录的区间，不跟最新。

工程自带的 `pnpm-workspace.yaml` 只做一件事：声明 `allowBuilds`。pnpm 12 起「未批准的构建脚本」是硬错误，会让 `pnpm install` 整个失败；模板已批准 `esbuild`、并给 `core-js` 显式写 `false`（「知道了、故意不跑」与「未批准」不是一回事）。报别的包时按提示补一行即可。

## 模板的组织方式

`template/v1/__PROJECT__/` 是框架无关的骨架，`template/v1/overlays/<id>/` 是叠加层。叠加规则：同路径文件覆盖骨架，根目录的 `*.patch.json` 深合并进 `package.json`。

`template-meta.json` 的 `frameworks` / `shells` 声明有哪些可选项，每项 `id` 对应一个叠加层目录；缺省项（`none` / `browser`）没有目录，表示这一层什么都不加。`sources` 也留在清单里，但它不参与形态问答——它声明的是故事示例的附带方式：缺省 `ts` 没有目录（整条创作链本来就在骨架里），`story` 有目录，只额外附一份手写 `.story` 示例，不摘任何骨架文件。合并顺序固定为「骨架 → 框架 → 故事源 → 壳」：故事源晚于框架层，壳放最后，因为它对工程形态有最终发言权（小程序壳会删掉骨架的 `src/host`）。

`.gitignore` 在模板里存成不带点的 `gitignore`：npm 把包装进 `node_modules` 时会把包内的 `.gitignore` 改名成 `.npmignore`，按原名存会导致生成的工程既缺忽略规则又多个无用文件。

## 示例故事

骨架自带的是 TS 源的示例：`src/Stories.src/title/*.ts` 里两列（`title_main` 与 `look_around`），编译成 `Resources/Stories/title/*.json` 随骨架一起交付。`--sources story` 额外附的那份手写示例在 `Resources/Stories/manual/manual_intro.story`，列 id 全在 `manual_` 命名空间里，与骨架自带的两列不撞名，它把几件事都演了一遍：

```text
scene manual_intro type=ui
  say "这一段来自 Resources/Stories/manual/manual_intro.story。"
  say "文本故事、手写 JSON、TS 源可以同时在 Resources/Stories/ 下混装；列 id 全工程唯一即可。"
  menu "接下来去哪里？"
    "看对话与输入" -> manual_talk
    "看舞台元素" -> manual_stage

scene manual_talk
  input "先问一句：你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  say "这一列是 game 列：从这里开始，每一步都可回溯、可存档。"
  menu "接下来去哪里？"
    "看舞台元素" -> manual_stage
    "回这一列开头" -> manual_talk

scene manual_stage
  panel x=5% y=10% width=90% zindex=10
    text "scene 列 = 声明式空间层：这些方块是元素，不是对话"
    text "panel 是容器，子元素用更深缩进写"
  say "进入 scene 列：元素已整体装载（回顾/读档会自动随行）。"
  say "下一条会隐藏对话框，再下一条让它回来。"
  window hide
  say "（对话框已隐藏——点击继续）"
  window show
  say "对话框回来了。层级、存档槽位等工程配置见 README 的边界表。"
```

`type=ui` 的列不进历史、不进存档、不建检查点——它是界面，不是剧情；引擎对这类列只管按 op 渲染。
同样的三列改成 TS 写，就是 `src/Stories.src/title/*.ts` 里的形式，产物是同名的 `.json`——两种写法编出同一份运行期结构。

换成自己的故事时，删掉这些示例列即可；也可以留着它们，在旁边加自己的文件。

## 模板带了什么

模板自带的宿主不依赖任何 UI 框架，直接操作 DOM。它接了这些：

| 能力                                            | 状态                                   |
| ----------------------------------------------- | -------------------------------------- |
| 对话层（打字机、`{p}` `{w}` 停顿、样式标记）    | 已接                                   |
| 等待态出口：`menu` / `input` / `wait` / `video` | 已接                                   |
| 等待态：`minigame`                              | 已接，但显示「未注册」提示，不伪造完成 |
| 舞台元素层（36 种元素 + 交互 + 12 个表现 op）   | 已接，含帧驱动                         |
| 层级 z 序（`shell.layers`）                     | 已接                                   |
| 存档槽位（`shell.saves.slots`）                 | 已接                                   |

游玩界面的文字默认**不可选中**（`body` 上 `user-select: none`）：拖动、连点、双击都不该在台词或按钮上留下选中段。要提供复制能力，给那个部件加 `data-lf-selectable` 放行——输入框已经放行，否则 `input` op 没法选词改写。

## 模板没接什么

这张表里的「没接」都是**模板宿主没写**，不是引擎没有。升级路线见 `apps/playground`——它同时是模板的第一个实例。

| 能力                                | 为什么没有                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 存档缩略图                          | 模板的存档不传截图，存出来就是无缩略图的档。                                                                                            |
| 历史面板与回溯 UI                   | 引擎侧接口齐全，模板没做面板。                                                                                                          |
| 玩家偏好面板（音量、文字速度）      | 未接时音量取 op 里写的值，打字机速度取故事级 `text_typewriter`。                                                                        |
| I18N 供给                           | 未接 `i18nPort` 时原文直出。`Lang/` 目录里的译文不会被读。                                                                              |
| 对话框模板注册（`say template=`）   | 未接时用内建默认骨架。                                                                                                                  |
| 屏幕方向锁定（`shell.orientation`） | 纯 Web 没有方向 API，这条只在桌面壳生效。                                                                                               |
| 舞台适配（`shell.stage`）           | 模板宿主是固定视口布局，没接缩放适配。接法：取 `resolveStageConfig` 的结果，用 `@lingfan-engine/shell` 的 `computeStageLayout` 算变换。 |
| 资源加密                            | 模板宿主装的是静态资源根，直接按路径取文件。加密要平台层解密后再给地址，链路见[加密与平台供给](/concepts/encryption/)。                 |
| 热重载                              | 靠监视源资源根触发，纯 Web 形态没有文件系统监视。                                                                                       |
| 宿主信息                            | 模板宿主不读运行平台，桌面和移动端走同一套。平台事实只在少数取资源方式上用得到。                                                        |

注意 `minigame` 那一行：模板会显示「未注册」并说明怎么接入，而不是当作成功继续。如果你的故事里有 `minigame`，得自己注册实现。

## 打包分发

```sh
pwsh -File pack-template.ps1 -SourceDir ./__PROJECT__ -OutputFile ./__PROJECT__.zip
```

排除 `node_modules/`、`dist/`、`.git/`、`Resources/Saves/`。后两项是运行期产物，不进模板。

## 模板版本

`template-meta.json` 是模板版本的唯一来源，独立于引擎版本：

```json
{
  "version": "1.13.0",
  "minEngineVersion": "0.3.2",
  "placeholder": "__PROJECT__",
  "frameworks": [
    {
      "id": "none",
      "label": "原生（框架无关）",
      "hint": "只用骨架，不叠加任何框架层"
    },
    {
      "id": "vue",
      "label": "Vue 3",
      "hint": "页面结构换成单文件组件，装配与宿主不变",
      "excludes": ["react", "miniprogram"]
    },
    {
      "id": "react",
      "label": "React",
      "hint": "页面结构换成 JSX 组件，装配与宿主不变",
      "excludes": ["vue", "miniprogram"]
    }
  ],
  "shells": [
    {
      "id": "browser",
      "label": "浏览器",
      "hint": "只生成 Web 端工程，用 vite 起本地服务"
    },
    {
      "id": "tauri",
      "label": "桌面（Tauri 2）",
      "hint": "给同一份工程再加一个桌面壳：存档落到应用数据目录，页面结构不变",
      "excludes": ["miniprogram"]
    },
    {
      "id": "miniprogram",
      "label": "小程序（UniApp）",
      "hint": "页面层换成 UniApp Vue 3 单文件组件，宿主装配走小程序端口",
      "excludes": ["vue", "react", "tauri"]
    }
  ],
  "sources": [
    {
      "id": "ts",
      "label": "TypeScript 源（Stories.src）",
      "hint": "骨架自带：用 TS 写故事列，有类型补全与重构，构建时编译成故事文件"
    },
    {
      "id": "story",
      "label": "附带手写故事示例",
      "hint": "多放一份 .story 示例，与 TS 源共存，不摘任何东西"
    }
  ]
}
```

`frameworks` / `shells` / `sources` 各自的第一个元素是该维度的缺省值（`sources` 不参与形态问答，只决定要不要额外附故事示例）。`excludes` 声明这一层不能与哪些层共存，元素是层 `id`、可以跨维度引用；问答里的互斥提示与合法性判断都由它推导，不在别处维护白名单。互斥只写在一边也能生效，成对写是为了读的人一眼看得清。`minEngineVersion` 是模板要求的最低引擎版本，升级引擎之前先看这个值——模板可能用到了新引擎才有的能力。

## 下一步

- [工程结构](/project-structure/)：每个目录和字段的细节。
- [视觉元素](/concepts/elements/)：示例里那个 `panel` 的完整类型表。
- [扩展引擎](/concepts/extensions/)：往引擎里加自己的 op。
