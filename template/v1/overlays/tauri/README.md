# 桌面壳层（Tauri 2）

这一层是**壳**，不是框架层：页面结构沿用骨架那一份，`index.html` 与 `vite.config.ts` 原样保留。
加进来的只有工程根下的 `src-tauri/`、一份清单补丁，以及本层自己的组合根 `src/main.ts`——
它覆盖骨架的同名文件，只把存档端口换成 Rust 实现。

## 内容

- `src-tauri/Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`
- `src-tauri/src/`：`main.rs`（转发到库入口）、`lib.rs`（装配与命令注册）、`save.rs`、`preferences.rs`
- `src/main.ts`：覆盖骨架的组合根，`ports.saves` 换成 `createTauriSavePort()`
- `package.patch.json`：补 `@tauri-apps/api`（运行时）与 `@tauri-apps/cli`（命令行），加 `tauri` 脚本

窗口 1280×720，标题取工程名；`frontendDist` 指向 `../dist`，开发期 `devUrl` 指向
`http://localhost:1420`（与骨架 `vite.config.ts` 的 `server.port` 一致），所以 `beforeDevCommand`
直接跑骨架的 `pnpm dev`。

## 最小子集：只做两件事

### 存档换成文件

`save_write` / `save_read` / `save_delete` / `save_list`，一槽一文件落在应用数据目录的 `saves/` 下，
写临时文件再改名，避免半截 JSON 覆盖好档；槽位名只放行字母数字与 `-` `_`，挡住 `..` 这类逃逸路径。

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
壳层只负责把端口接到原生侧（插口是骨架的 `src/ports.ts` 与 `bootHost` 的 `ports` 选项）。

## 怎么用

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会先跑骨架的 `vite`，再编译 Rust 侧并开窗。首次编译要下依赖，耗时在 Rust 侧。

打包命令（`pnpm tauri build`）本层不在自动化流程里跑，需要时由人手工执行。
