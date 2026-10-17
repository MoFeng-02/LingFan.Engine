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

## 目录

| 路径                          | 作用                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `src/pages/index/index.vue`   | 页面装配：取画布 → 启动宿主 → 补丁进页面状态 → 动作交回覆盖层         |
| `src/components/NodeTree.vue` | 递归节点树：把描述树铺成节点（小程序组件样式隔离，样式自带）          |
| `src/host/host.ts`            | 组合根：装载工程 → 建引擎 → 建表面 → 建覆盖层 → 起帧循环              |
| `src/host/surface.ts`         | 覆盖层表面：把「每层显示什么」翻成页面数据补丁（小程序没有 DOM）      |
| `src/host/view.ts`            | 描述树 → 节点数据；舞台盒的行内样式串（基准尺寸 + 平移缩放）          |
| `src/host/platform.ts`        | **平台全局 `uni` 唯一取用点**：系统信息、同步存储、画布节点、尺寸变化 |
| `src/host/ports.ts`           | 端口装配：存档 / 偏好 / 资源地址落到微信同步存储与包内路径            |
| `src/host/frame.ts`           | 帧源：有画布走画布 rAF，没有退回定时器（约 60 帧/秒）                 |
| `src/host/fixture.ts`         | 内建演示工程：示例故事随包打进来，宿主不依赖文件系统                  |

## 口径

- **层次与桌面宿主一致**：舞台层是唯一带基准尺寸与变换的容器（画布等比缩放，缩放与偏移来自
  `@lingfan/shell` 的 `computeStageLayout`，行内样式串由 `host/view.ts` 的 `stageStyle` 拼成数据），
  对话 / 选择 / 通知各层住在窗口坐标系里，尺寸只跟窗口走（页面自身用 `rpx`，舞台内的元素尺寸来自
  叙事数据的基准像素——两者不混用）。
- **平台中立**：宿主自己的名字不带平台名（目录 `apps/miniprogram`、包名 `@lingfan/miniprogram`），
  换端只动 `@lingfan/adapters` 的取件；`packages/*` 不依赖任何小程序 API，平台差异（含 `uni` 全局）
  收在 `src/host/platform.ts` 与适配器包里（`tests/miniprogram/app-host.test.ts` 有互锁）。目前只接了
  `mp-weixin` 一个编译目标，其余端按同一份页面代码另接适配器族即可。
- **依赖钉版**：UniApp 工具链的 `@dcloudio/*` 各包共用同一版本号，且 `@dcloudio/vite-plugin-uni` 对
  vite 有硬约束（peer `5.2.8`）——所以本包自带一份 vite，与仓库根的大版本各用各的（pnpm 隔离安装）。
