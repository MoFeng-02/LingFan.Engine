# 桌面壳层（Tauri 2）

这一层是**壳**，不是框架层：页面结构沿用骨架那一份，`index.html` 与 `vite.config.ts` 原样保留。
加进来的只有工程根下的 `src-tauri/` 和一份清单补丁——**不带组合根**：入口与页面结构
永远归属框架层，否则 `-f vue` / `-f react` 时壳层的节点解析会与框架层渲染的页面错配。
桥的装配在骨架 `src/host/native-ports.ts`，由各形态的组合根统一调用。

## 内容

- `src-tauri/Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`
- `src-tauri/src/`：`main.rs`（转发到库入口）、`lib.rs`（装配与命令注册）、`save.rs`、`preferences.rs`、`orientation.rs`
- `package.patch.json`：补 `@tauri-apps/cli`（命令行）与 `tauri` 脚本

窗口 1280×720，标题取工程名；`frontendDist` 指向 `../dist`，开发期 `devUrl` 指向
`http://localhost:1420`（与骨架 `vite.config.ts` 的 `server.port` 一致），所以 `beforeDevCommand`
直接跑骨架的 `pnpm dev`。

## 最小子集：只做两件事

### 存档换成文件

`save_write` / `save_read` / `save_delete` / `save_list`，一槽一文件落在应用数据目录的 `saves/` 下，
写临时文件再改名，避免半截 JSON 覆盖好档；槽位名只放行字母数字与 `-` `_`，长度 1–64，挡住 `..` 这类逃逸路径。
错误以 `{ code, detail }` 结构化返回（`invalid-slot` / `io` / `bad-format`），前端适配器按码映射可读文案。

**安全口径（显式降格）**：本层存档是**明文 JSON 参考实现**——不加密、无防回档高水位、不加密资源。
K1–K8 安全全栈（密钥托管 / 每档独立密钥 / 槽位绑定 / 高水位防回档等）只在参考宿主 playground 实现；
需要交付安全的工程必须自带 Rust 加密层，不要把本层存档当作安全实现。明文不等于无校验：
槽位校验、原子写、结构化错误照常执行。

为什么换：WebView 的 `localStorage` 落在系统给这个应用分配的 WebView 数据目录里，清缓存、换系统账户、
重装都会带走存档；桌面工程的存档应当是可指路径上的文件。

### 偏好换成文件

`preferences_read` / `preferences_write`，明文落在 `app_data/preferences.json`——偏好只有音量、
语言这类非敏感项，解密负担留在存档域；字段校验交给前端 `PlayerPreferences.hydrate`，
新增偏好项不必同步改 Rust。

命令名与参数形状是**跨语言契约**：`packages/adapters/src/save/tauri.ts` 与
`src/preferences/tauriPreferences.ts` 按这些名字 invoke，改名要两边同时改。

## 工程文件与资源：不换端口，也不造命令

骨架的 `vite.config.ts` 把 `Resources/` 当静态根，打包时这些文件被复制进 `dist/`，
所以打包后 `/project.json`、`/Stories/**`、`/Audio/x.mp3` 仍按同一套路径取得到。
桌面壳不需要为此多造一组 Rust 命令，也不需要 `fs` 能力或 `asset` 协议——
除非工程要读**运行时可变的**外部目录（那时该加的是一对「端口 + 适配器」，不是往本层塞命令）。

## 故意不提供的

资源加密、媒体 HTTP 服务、zip 索引、工程写回、开发期 WS——这些在参考宿主里有实现，
本层不带。要加密或媒体服务的工程自己加：能力以端口 + 适配器成对出现，
壳层只负责把端口接到原生侧（插口是 `bootHost` 的 `ports` 选项，
现有的原生存档端口见骨架 `src/host/native-ports.ts`）。

## 安全口径

### CSP

`tauri.conf.json` 的 `app.security.csp` 设为最小权限策略，逐条理由：

- `script-src 'self'`：只放行本应用构建产物里的脚本。构建产物是预编译的，不需要 `unsafe-eval`；
  Tauri 会自动为它注入的 IPC 脚本补 nonce/hash，无需手工放行。
- `style-src 'self' 'unsafe-inline'`：引擎运行期会给元素写内联样式（位置 / 层级 / 过渡），
  必须放行内联样式；这只影响样式边界，不放开脚本。
- `connect-src 'self' ipc: http://ipc.localhost`：同源请求（工程文件 / 故事数据）加 Tauri IPC 的两种形态。
- `img-src` / `media-src` / `font-src`：同源加 `data:`（存档缩略图、内嵌字体）与 `blob:`（媒体对象 URL）。
- `object-src 'none'`、`base-uri 'self'`：关掉插件对象与 base 标签劫持。

### Isolation 模式：不启用

Tauri 的 Isolation Pattern 在前端与 IPC 之间加一层隔离 iframe，代价是多一层消息往返与构建复杂度。
本层命令面最小（存档 / 偏好 / 屏幕方向），页面不加载第三方不可信内容，
`capabilities/default.json` 只授 `core:default`，CSP 已锁死外联——启用 Isolation 的边际收益低，
故不启用；接入自带安全层或引入不可信内容时再评估。

## 怎么用

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会先跑骨架的 `vite`，再编译 Rust 侧并开窗。首次编译要下依赖，耗时在 Rust 侧。

打包命令（`pnpm tauri build`）本层不在自动化流程里跑，需要时由人手工执行。
