# @lingfan/miniprogram — 小程序宿主（UniApp）

用 UniApp（Vue 3）写页面层，把叙事引擎的端口接在小程序的能力上。这一层只做三件事：
取画布、把宿主给的补丁写进页面状态、把点击与输入交回覆盖层——叙事逻辑一律不在这里。

**包里只装代码**：故事与素材都是内容，由服务端经 HTTP 提供（工程接口一次返回清单与全部故事，
资源按同一基址取）。所以演示工程放在包外的 `project/` 目录，开发时用本地服务提供，发布时换成
自己的静态托管 + 接口地址。

## 命令

```bash
pnpm --filter @lingfan/miniprogram serve:project # 本地提供演示工程（http://127.0.0.1:5273，仅开发用）
pnpm --filter @lingfan/miniprogram dev        # 编译到 mp-weixin（watch），产物 dist/dev/mp-weixin
pnpm --filter @lingfan/miniprogram build      # 编译到 mp-weixin，产物 dist/build/mp-weixin
pnpm --filter @lingfan/miniprogram dev:h5     # 浏览器里预览同一份页面代码
pnpm --filter @lingfan/miniprogram typecheck  # 本包单独类型检查（仓库根 `pnpm -w run typecheck` 已覆盖）
```

**开发时先起 `serve:project` 再起 `dev`**：页面一进就要拉工程，工程接口不通会停在错误态
（宿主对装载失败是 fail-closed，不会拿空工程继续跑）。基址可用环境变量 `VITE_PROJECT_BASE_URL`
覆盖（要 http(s) 绝对地址），改完重新编译小程序。

用微信开发者工具**导入** `apps/miniprogram/dist/dev/mp-weixin`（或 `dist/build/mp-weixin`）即可预览；
`dist/` 是构建产物，不入版本库。

## 在微信开发者工具里验证（已跑通）

`src/manifest.json` 的 `mp-weixin.appid` 现在写的是一个**测试号 AppID**（`wx2a603d61ee137d96`），
只为让产物导入后能直接编译；正式开发请换成自己的 AppID。`libVersion` 显式钉成 `3.15.1`，
不让 IDE 去猜基库版本。

自动化验证（真机模拟器，走 `miniprogram-automator`）：

```bash
# 依赖装在仓库外，避免污染工程依赖
npm install --prefix %TEMP%\mpauto miniprogram-automator
set AUTOMATOR_ROOT=%TEMP%\mpauto\node_modules\miniprogram-automator
set MP_NAME=阿寻
node 项目记录 apps\miniprogram\dist\build\mp-weixin 项目记录
```

脚本自己起 `cli auto`（`--auto-port`，默认 9430）再连上去，然后：反复点 `.viewport` 推进 →
等 `.input-box` 出现 → 打字 → 点 `.submit` → 截图留证。跑通的读数是「推进 16 次到达输入等待态，
输入「阿寻」后台词变成「阿寻，欢迎来到灵泛！12」」。

媒体这一段同样可以自动验（`项目记录`，端口默认 9431）：

```bash
set AUTOMATOR_ROOT=%TEMP%\mpauto\node_modules\miniprogram-automator
set AUTO_PORT=9431
node 项目记录 apps\miniprogram\dist\dev\mp-weixin 项目记录
```

它照真机路径走一遍演示故事（一进页面就有 `bgm`，输入名字后是 `cutscene`），验三件事：视频字段落进
页面数据（实测 `f=http://127.0.0.1:5273/Video/m1.mp4`、可见 `true`、音量 `0.8`、循环 `false`，与故事里
的 `cutscene` 一致）、从起播到收起之间没有媒体类日志（`mediaErrors` 为空）、「组件播完 → 宿主 →
`engine.videoFinished()`」这条回传链通（给组件触发一次 `ended` 后视频层收起、引擎继续往下执行）。
报告落在证据目录的 `media-report.json`。

两条环境限制要说明：这版开发者工具（Stable v2.01.2510280）的 `App.captureScreenshot` 不回包、
CDP 通道又是 `unimplemented`，所以媒体这段拿不到截图，证据是 JSON 报告；另外模拟器里视频不会自动
解码起播（`naturalEnd: false`），所以「真的听见、真的看见」必须在真机上确认——开发者工具点「真机
调试」扫码后，耳边是约 20 秒的蟋蟀环境音，名字提交后是一段可点跳过的过场视频。

屏幕方向也只在真机/手动下看得准：`src/pages.json` 的页面配置里声明了 `pageOrientation: "auto"`，
开发者工具工具栏的「旋转」按钮（或真机横过来）就能看到横屏版式；自动化通道没有旋转能力，这一项
不列入自动化读数。

## 目录

| 路径                             | 作用                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/pages/index/index.vue`      | 页面装配：取画布 → 启动宿主 → 补丁进页面状态 → 动作交回覆盖层                                     |
| `src/components/NodeTree.vue`    | 递归节点树：把描述树铺成节点（小程序组件样式隔离，样式自带）                                      |
| `src/host/host.ts`               | 组合根：装载工程 → 建引擎 → 建媒体渲染器 → 建表面 → 建覆盖层 → 起帧循环 → 对外给存读入口          |
| `src/components/SaveLoadBar.vue` | 存读入口条与槽位面板：入口「存 / 读」，面板槽位来自工程清单的槽数与存档快照                       |
| `src/host/project-source.ts`     | 工程来源：工程接口地址与远端资源根（基址一处，`VITE_PROJECT_BASE_URL` 可覆盖）                    |
| `src/host/guards.ts`             | 演示工程的守卫实现：故事只写守卫名，实现随宿主代码带上（未登记即运行期 fail-closed）              |
| `src/host/surface.ts`            | 覆盖层表面：把「每层显示什么」翻成页面数据补丁（小程序没有 DOM）                                  |
| `src/host/view.ts`               | 描述树 → 节点数据；舞台盒的行内样式串（基准尺寸 + 平移缩放）                                      |
| `src/host/slots.ts`              | 存读入口的取件与分派：槽位清单来自存档快照，点哪个槽位由「模式 + 是否空槽」判据决定               |
| `src/host/platform.ts`           | **平台全局 `uni` 唯一取用点**：系统信息、同步存储、网络请求、画布节点、尺寸变化、音视频柄         |
| `src/host/ports.ts`              | 端口装配：存档 / 偏好 / 资源地址 / 音频 / 视频落到平台能力与呈现面                                |
| `src/host/video-surface.ts`      | 视频呈现面：端口命令 → 页面数据（`src`/显隐/音量），控制动作走 `videoContext`                     |
| `src/host/frame.ts`              | 帧源：有画布走画布 rAF，没有退回定时器（约 60 帧/秒）                                             |
| `project/`                       | 包外演示工程（`project.json` + `Stories/**` + `Audio/` `Video/` `Images/`），开发时由本地服务提供 |
| `scripts/serve-project.mjs`      | 本地开发服务：`GET /project` 合成清单与故事，其余路径按静态资源 + Range 提供                      |

## 口径

- **内容在远端，包里只有代码**：故事与素材都属于内容，由服务端经 HTTP 提供——小程序包体不装它们，
  改故事、换素材不必重新提审发版。取法两条：工程接口一次返回 `{manifest, stories}`（故事原文，
  解析归引擎的组装器），资源按同一个基址拼地址（故事里仍写裸 id `Audio/crickets_night01.mp3`，
  端口拼成 `<基址>/Audio/crickets_night01.mp3`）。基址只有 `host/project-source.ts` 一处常量，
  可用 `VITE_PROJECT_BASE_URL` 覆盖；配错（非 http(s)、拼坏地址）在启动时直接抛错，不带到播放阶段。
  开发期的接口与静态托管由 `scripts/serve-project.mjs` 扮演，生产换成自己的服务即可，宿主只换基址。
  `tests/miniprogram/app-host.test.ts` 有互锁：演示故事引用的每个资源都必须在 `project/` 里存在
  （缺一个就是哑音或黑屏），且 `src/` 下不许有 `static/`、`fixture/` 这类随包内容。
- **内容体积不受主包限制**：素材放服务端后不必再按主包上限压缩，`project/` 里这份是按演示需要
  压过的（视频 178 KB、环境音 83 KB），换成高清原片也只是流量与加载时间的问题。
- **守卫随代码，名字随内容**：故事里的 `{"op":"guard","fn":"gold-non-negative"}` 只是名字，实现必须
  由宿主注册（引擎是组合根注册制，未登记即在运行期 fail-closed 并停在当前命令）。演示工程的两个
  守卫（`gold-non-negative`、`tour-open`）写在 `src/host/guards.ts`，语义与
  `apps/playground/Stories.src/lib/guards.ts` 的 cell 声明一致；服务端换故事时如果引入新守卫名，
  宿主必须同步补实现。两道闸：装载完成即 `findMissingGuards(story, guards)` 对名字（缺名在起播前
  一次报全，报错串列出所有缺的），运行期引擎仍按组合根注册制 fail-closed。判据互锁
  `tests/miniprogram/app-host.test.ts`：故事里出现的每个 `fn` 都要在注册表里，且组合根确实把注册表
  交给了引擎、装载后有这次校验。引擎侧还有 `tests/engine/runtime/guard-names.test.ts` 7 例守住走查
  形状（两类列、`if` 嵌套、`args` 里的同形对象不算命令）。
- **存读入口与桌面同一份判据**：页面左上角的入口条给出「存 / 读」，槽位数取自工程清单
  （`project.json` 的 `shell.saves`，缺省 6 槽），槽位标题与空槽判断都来自存档快照本身；
  点槽位的合法性判据复用 `@lingfan/shell` 的 `canChooseSlot`（与桌面面板同一份）。命令只落在
  宿主组合根：`saveGame` / `loadGame` 转给引擎，命令返回只代表「被接受」，真正落地以
  `save.done` / `load.done` 事件为准；读档完成后要重渲覆盖层并重对齐媒体（读档换列后音视频源要重取）。
- **存档点与作用域**：引擎契约里块 / 列级作用域（`let` / `local` 声明）随帧出栈销毁、不进存档，
  读档只从存档坐标重放。因此把存档点放在「同列更早位置声明过 `let`」的画面之后，读档后该变量
  不存在（表现为插值失败并保留原文）——这是引擎的作用域口径，不是宿主缺陷；验收与演示都取
  列级声明之前的画面。
- **层次与桌面宿主一致**：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放，缩放与偏移来自
  `@lingfan/shell` 的 `computeStageLayout`，行内样式串由 `host/view.ts` 的 `stageStyle` 拼成数据），
  对话 / 选择 / 通知各层住在窗口坐标系里，尺寸只跟窗口走（页面自身用 `rpx`，舞台内的元素尺寸来自
  叙事数据的基准像素——两者不混用）。
- **面板形态与桌面同源**：对话、选择、通知三层的结构类名、色值与形态跟桌面面板
  `apps/playground/src/App/DialoguePanel.vue` 一一对应（`.dialogue` / `.speaker` / `.text` /
  `.advance-hint` / `.layer-prompt` / `.choice-row` / `.nvl-body` / `.tpl-center` /
  `.tpl-notify-*`，底色 `rgba(30,30,46,·)`、强调色 `#7aa2f7`）。差别只在单位——桌面用
  `px` + `clamp` 跟窗口，页面按平台惯例用 `rpx`（宽度基准 750），比例同源、绝对尺寸按宽度折算。
  **桌面那份是基准**：改形态时两处一起改，`tests/miniprogram/app-host.test.ts` 有三条互锁
  （同名结构、同色值、`.nvl-body`/`.nvl-mode` 都在），改一边另一边会红。
- **NVL 累积层走投影，不进表面契约**：`OverlaySurface` 只有对话/选择/通知三层（桌面宿主是读
  渲染投影自己渲染累积层），小程序沿用同一条通道——组合根把 `onView` 接下来交给
  `surface.setNvl()`，表面把「已打完的行 + 正在打字的最新一行」翻成 HTML 交给页面。可见性仍归
  对话层（菜单/输入/视频等待时整层让位），NVL 只是对话容器的另一种内容形态（`.nvl-mode` 把卡片
  抬成阅读区）。`app-host.test.ts` 有 7 例守住这条：激活/退出/打字帧缓存/清层/`onView` 唯一通道/
  页面绑定/两端同源。
- **平台中立**：宿主自己的名字不带平台名（目录 `apps/miniprogram`、包名 `@lingfan/miniprogram`），
  能力面也统一：`@lingfan/adapters` 的中立族（`miniprogram/`）只吃注入的能力面（同步存储、音频实例、
  视频呈现面、画布），里面没有一行厂商 API；厂商差异只落在 `src/host/platform.ts` 的取用面上。
  `packages/*` 不依赖任何小程序 API，`tests/miniprogram/app-host.test.ts` 有三条互锁：`uni` 只在
  `platform.ts`、宿主模块里没有 `wx.` / 厂商命名、端口装配取中立族。目前只接了 `mp-weixin` 一个编译
  目标，换到别的小程序端只换 `platform.ts` 的取用面与 `manifest.json` 的目标段。
- **依赖钉版**：UniApp 工具链的 `@dcloudio/*` 各包共用同一版本号，且 `@dcloudio/vite-plugin-uni` 对
  vite 有硬约束（peer `5.2.8`）——所以本包自带一份 vite，与仓库根的大版本各用各的（pnpm 隔离安装）。
- **媒体两端形态不同**：音频是命令式实例（`uni.createInnerAudioContext`，每条通道一个，位置由渲染器
  逐帧回写、与打字机同一条帧时间线）；视频是声明式组件（页面里的 `<video id="stage-video">`），宿主
  只推数据（`src`/显隐/音量/循环），暂停、续播、定位走 `uni.createVideoContext`，自然播完由页面把
  `bindended` 回传给宿主，宿主再交 `engine.videoFinished()` 解除 cutscene 等待。音量偏好随
  `PlayerPreferences` 水合生效（与桌面宿主同一套设置）。
- **屏幕方向由静态配置声明**：页面在 `src/pages.json` 里写 `pageOrientation: "auto"`（跟随系统旋转；
  要强制横屏改成 `landscape`，两值分别要求基库 2.4.0 / 2.5.0）。微信没有运行期改页面方向的 API，
  所以工程 `project.json` 的 `shell.orientation` 到小程序端只能落在这份静态配置上（桌面宿主走
  `OrientationPort`：Tauri 真调原生、浏览器 noop）。横屏版式靠两条纪律成立：**层高一律用视口百分比**
  （竖屏写死的 `rpx` 高度横过来会被放大成近屏高），**方向相关的字号/内边距在
  `@media (orientation: landscape)` 里换成 px**（`rpx` 基准是宽度，横屏会把字撑大）。旋转后舞台由
  `watchWindowResize` → `started.resize()` 重算，`tests/miniprogram/app-host.test.ts` 有 3 例守住
  （`pageOrientation`、百分比层高、横屏媒体查询与 px 覆盖）。
