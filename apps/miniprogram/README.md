# @lingfan/miniprogram — 小程序宿主（UniApp）

用 UniApp（Vue 3）写页面层，把叙事引擎的端口接在小程序的能力上。这一层只做三件事：
取画布、把宿主给的补丁写进页面状态、把点击与输入交回覆盖层——叙事逻辑一律不在这里。

## 命令

```bash
pnpm --filter @lingfan/miniprogram dev        # 编译到 mp-weixin（watch），产物 dist/dev/mp-weixin
pnpm --filter @lingfan/miniprogram build      # 编译到 mp-weixin，产物 dist/build/mp-weixin
pnpm --filter @lingfan/miniprogram dev:h5     # 浏览器里预览同一份页面代码
pnpm --filter @lingfan/miniprogram typecheck  # 本包单独类型检查（仓库根 `pnpm -w run typecheck` 已覆盖）
```

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

## 目录

| 路径                          | 作用                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `src/pages/index/index.vue`   | 页面装配：取画布 → 启动宿主 → 补丁进页面状态 → 动作交回覆盖层                   |
| `src/components/NodeTree.vue` | 递归节点树：把描述树铺成节点（小程序组件样式隔离，样式自带）                    |
| `src/host/host.ts`            | 组合根：装载工程 → 建引擎 → 建媒体渲染器 → 建表面 → 建覆盖层 → 起帧循环         |
| `src/host/surface.ts`         | 覆盖层表面：把「每层显示什么」翻成页面数据补丁（小程序没有 DOM）                |
| `src/host/view.ts`            | 描述树 → 节点数据；舞台盒的行内样式串（基准尺寸 + 平移缩放）                    |
| `src/host/platform.ts`        | **平台全局 `uni` 唯一取用点**：系统信息、同步存储、画布节点、尺寸变化、音视频柄 |
| `src/host/ports.ts`           | 端口装配：存档 / 偏好 / 资源地址 / 音频 / 视频落到平台能力与呈现面              |
| `src/host/video-surface.ts`   | 视频呈现面：端口命令 → 页面数据（`src`/显隐/音量），控制动作走 `videoContext`   |
| `src/host/frame.ts`           | 帧源：有画布走画布 rAF，没有退回定时器（约 60 帧/秒）                           |
| `src/host/fixture.ts`         | 内建演示工程：示例故事随包打进来，宿主不依赖文件系统                            |
| `src/fixture/`                | 演示工程本体（`project.json` + `Stories/**`），由 `fixture.ts` 在构建期收进包内 |

## 口径

- **层次与桌面宿主一致**：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放，缩放与偏移来自
  `@lingfan/shell` 的 `computeStageLayout`，行内样式串由 `host/view.ts` 的 `stageStyle` 拼成数据），
  对话 / 选择 / 通知各层住在窗口坐标系里，尺寸只跟窗口走（页面自身用 `rpx`，舞台内的元素尺寸来自
  叙事数据的基准像素——两者不混用）。
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
