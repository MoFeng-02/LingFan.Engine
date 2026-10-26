# **PROJECT**

灵泛叙事引擎工程的小程序形态：页面层是 UniApp（Vue 3）单文件组件，宿主装配在 `src/mp/**`，
内容（故事与素材）不进包体，走 HTTP 从工程接口取。

## 目录

| 路径                                  | 作用                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `src/pages/index/index.vue`           | 页面装配：取画布、把宿主补丁写进页面状态、把手势转回覆盖层           |
| `src/components/**`                   | 舞台、对话、选择、通知四层，加存读条与递归节点树                     |
| `src/mp/**`                           | 小程序宿主：`uni` 能力封装、端口、渲染数据、覆盖层、视频、帧源、守卫 |
| `src/App.vue`、`src/main.ts`          | 应用外壳与 UniApp 约定入口                                           |
| `src/pages.json`、`src/manifest.json` | 页面与平台声明                                                       |
| `Resources/`                          | 内容根：清单、故事、音频、视频、图片（**不随包体分发**）             |
| `scripts/serve-project.mjs`           | 开发期内容服务                                                       |

## 起工程

先起内容服务：它把 `Resources/` 按宿主的取法提供出去（`GET /project` 一次返回
`{manifest, stories}`，`GET /<资源 id>` 取素材本体）。

```bash
node scripts/serve-project.mjs        # 缺省 127.0.0.1:5273，--port / --host / --root 可改
```

再编译页面，用微信开发者工具导入产物目录：

```bash
pnpm dev:mp        # 等价 uni -p mp-weixin，产物在 dist/dev/mp-weixin
pnpm build:mp      # 生产产物在 dist/build/mp-weixin
```

想在浏览器里先看效果（同一份页面代码）：

```bash
pnpm dev:h5        # 等价 uni
```

开发者工具里需要勾上「不校验合法域名」（开发期），生产换成自己的 HTTPS 域名；
`manifest.json` 的 `appid` 是空的，导入时填自己的。

内容服务只是开发期的替代品：生产形态由静态托管 + 后端接口承担同一套取法
（`GET <基址>/project`、`GET <基址>/<资源 id>`），宿主只换基址。基址用环境变量
`VITE_PROJECT_BASE_URL` 覆盖，缺省指向上面那个本地端口。

## 与浏览器形态的差别

- **谁渲染页面结构**：浏览器形态由 `index.html` 的静态节点承接 `must("#id")` 契约；这里由
  `src/components/**` 承接（`stage-canvas`、`stage-video` 两个 id 落在组件模板里）。
- **帧源**：浏览器用 `requestAnimationFrame`；这里取 `canvas` 的 2d 节点，取不到（或 300ms
  内没拿到）就退回 16ms 定时器，叙事照常推进，动画粒度略粗。
- **尺寸单位**：页面样式按平台惯例用 `rpx`（宽度基准 750），横屏媒体查询里换回 `px`。舞台盒
  的缩放与平移仍由 `computeStageLayout` 算，与单位无关。
- **平台能力入口**：`uni.*` 只在 `src/mp/platform.ts` 出现一处，其余全是端口；换端只改那一处。

## 包体只有代码

故事与素材不随包分发：内容走工程接口，素材走资源端口按 id 取（`Audio/x.mp3` →
`<基址>/Audio/x.mp3`）。改内容不必重新提审发版。

构建配置因此是 `publicDir: "Resources"` + `build.copyPublicDir: false`：资源根仍指向同一个
目录（H5 形态直接读它），但不进包体。

## 有意不做的事

- **不写原生 WXML/WXSS**：页面一律是 Vue 3 SFC，由 uni 编译成平台节点，H5 与小程序共用同一份
  页面代码。
- **不做节点树以外的渲染**：舞台元素走递归节点树（`view`/`text`/`rich-text`/`image`），不接管
  WebGL/Canvas 绘制。需要自定义绘制时另开端口，别塞进宿主。
- **不内建登录/支付/分享**：这里只做叙事播放面，平台能力按需另接。

## 依赖钉版

`@dcloudio/vite-plugin-uni` 的 peer 把 `vite` 钉在 `5.2.8`、`@vue/shared` 钉在 `3.4.21`，
与仓库根的 `vite ^8` / `vue ^3.5` 不是一代。本工程因此自带一份 `vite 5.2.8` 与 `vue 3.4.21`，
靠包管理器的隔离安装各用各的（`package.json` 里是把这些包写进 `create.pinned` 才保住的：
不钉住，脚手架会统一改写成 `^最新`，peer 立刻就破）。

代价：`vite.config.ts` 不能跟着升到 8，脚本与插件类型按 5 的形态写；上游哪天跟进新 vite，
这三处（`vite`、`vue`、插件）要成对改完再放开钉版。

## 被换掉的骨架文件

本形态换掉了整套页面与宿主，骨架里那些只服务浏览器形态的部件由本层
`package.patch.json` 的 `create.remove` 点名删除——生成器在合并时会真把它们从产物里去掉，
不会留在工程里：

| 路径            | 为什么不带       |
| --------------- | ---------------- |
| `src/host/**`   | 浏览器宿主的装配 |
| `src/styles/**` | 浏览器页面样式表 |

`src/vite-env.d.ts` 保留：它声明的 `virtual:story-fonts` 与本层 `vite.config.ts` 的字体插件
一一对应，`src/mp/project-source.ts` 里的 `import.meta.env` 也靠它拿到 `vite/client` 类型。

## 验收这条链路

```bash
pnpm typecheck                                   # vue-tsc + tsc（含 vite.config.ts）
node scripts/serve-project.mjs --root Resources
curl http://127.0.0.1:5273/project | head -c 200
```

`pnpm dev:mp` 之后用开发者工具导入 `dist/dev/mp-weixin`，模拟器里应当直接进标题页。

---

本工程由脚手架按「框架无关骨架 + 小程序叠加层」生成：`src/mp/**`、`src/components/**`、
`src/pages/**`、`index.html` 与 `package.json` 的增量来自该层，其余来自骨架。
改模板请在模板仓库里改，不要只改这一个工程。
