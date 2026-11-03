# 叠加层

每个子目录是一层可选的工程内容，目录名就是 `template-meta.json` 里 `frameworks[]` / `sources[]` / `shells[]` 的 `id`。
生成器按「骨架 → 框架层 → 故事源层 → 壳层」的顺序合并，同路径文件由后一层覆盖前一层。
故事源层的两个 id 不对称：缺省 `ts` 没有目录（链在骨架里），可选 `story` 有目录（要摘掉那条链）。

## 缺省项没有目录

`none`（框架无关）、`ts`（TypeScript 源）与 `browser`（浏览器）表示「这一层什么都不加」，所以这里看不到它们。
缺目录不是错误，只是没有内容可叠：缺省故事源形态的整条创作链（`src/Stories.src/`、`src/gen/*.gen.d.ts`、
`tsconfig.stories.json`、三条 `stories:*` 脚本）都在骨架里，生成时不需要再叠任何东西。

## 现有层

- `story/` —— 故事源层，与缺省形态反向：只换故事素材、不碰页面。骨架缺省是 TS 创作链，这一层用
  `create.remove` 把它整条摘掉（`src/Stories.src`、`src/gen/{font,script,state,stories}.gen.d.ts`、
  `tsconfig.stories.json`），换上一份手写的 `Resources/Stories/title/title_main.story`，改完保存即生效。
  `create.remove` 只认精确路径与目录子树，没有通配符，所以四份 `.gen.d.ts` 要逐个点名。
  骨架那三条 `stories:*` 脚本与 `@lingfan-engine/editor` 依赖由 `create.unset` 一并摘掉
  （`mergeManifest` 对依赖表是「新增或覆盖」，删键要靠 `unset` 显式点名）。
  故事清单不归本层管：骨架的 `vite.plugins.ts` 扫 `Resources/Stories/`，`.story` 与 `.json` 都进清单，
  层不需要也不应该覆盖 `src/stories/index.ts`。
- `vue/` —— 页面结构换成单文件组件：`index.html` 变成挂载点，新增 `src/App.vue` 与 Vue 版组合根，
  `package.patch.json` 补 `vue` / `@vitejs/plugin-vue` / `vue-tsc`，并把 `typecheck` 换成
  `vue-tsc --noEmit && tsc --noEmit -p tsconfig.node.json`。`src/host/**` 一行不改，
  样式仍用骨架的 `src/styles/stage.css`。
- `react/` —— 页面结构换成 JSX 组件：`index.html` 变成挂载点（`#app`），新增 `src/App.tsx`
  （渲染骨架 `must()` 要的全部节点）、React 版组合根 `src/main.tsx`（先 `createRoot` 挂载再读节点句柄，
  然后 `bootHost`）与 `src/vite-env.d.ts`，`vite.config.ts` 在骨架配置上多一个 `@vitejs/plugin-react`
  （`publicDir`、`server.port` 与字体虚拟模块逐项保留），`tsconfig.json` 打开 `jsx: react-jsx`。
  `package.patch.json` 补 `react` / `react-dom` 与 `@types/react` / `@types/react-dom` /
  `@vitejs/plugin-react` / `@types/node`，并把 `typecheck` 换成
  `tsc --noEmit && tsc --noEmit -p tsconfig.node.json`。`src/host/**` 一行不改，
  样式仍用骨架的 `src/styles/stage.css`。
- `miniprogram/` —— 壳层，换掉整套页面与宿主：页面结构由 `src/components/**` 承接（`stage-canvas`、
  `stage-video` 两个 id 落在组件模板里），宿主装配在 `src/mp/**`（`uni.*` 只在
  `src/mp/platform.ts` 出现一处），`src/main.ts` 按 UniApp 约定返回 `createSSRApp`，
  另有 `src/pages.json`、`src/manifest.json` 与开发期内容服务 `scripts/serve-project.mjs`。
  `vite.config.ts` 保留 `publicDir: "Resources"` 供 H5 形态取资源，同时用
  `build.copyPublicDir: false` 让小程序包体只有代码；`vite` 与 `vue` 钉在 UniApp 插件要求的
  那一代（`create.pinned` 保住），`tsconfig.json` 排除 `src/host/**`——那是浏览器形态的宿主，
  本形态不用它。
- `tauri/` —— 壳层，只加桌面外壳、不碰页面：新增 `src-tauri/`（`Cargo.toml`、`build.rs`、
  `tauri.conf.json`、`capabilities/default.json`、`src/{main,lib,save,preferences}.rs`）与
  一份覆盖骨架的组合根 `src/main.ts`（`ports.saves` 换成 `createTauriSavePort()`，其余端口不换）。
  `package.patch.json` 补 `@tauri-apps/api` / `@tauri-apps/cli` 与 `tauri` 脚本，
  `@tauri-apps/*` 用 `create.pinned` 钉住。`index.html`、`vite.config.ts` 与 `src/host/**`
  全部沿用骨架：`Resources/` 是 `publicDir`，打包时复制进 `dist/`，所以工程文件与资源仍按
  同一套路径取，不需要额外命令。

## 钉住版本

`package.patch.json` 可以带一个生成期字段 `create.pinned`：数组里点名的依赖不参与
「查 registry 写最新版」，版本区间保持骨架记录的原值，写盘前这个字段本身会被抹掉。

```json
{ "create": { "pinned": ["typescript"] } }
```

存在的理由：模板希望依赖尽量新，但上游并非都兼容——`vue-tsc` 在 `typescript` 7 上会因
`./lib/tsc` 不再导出而直接崩，这类约束只有层作者知道。只有确实需要时才钉，钉住的包不会再跟到
最新版。

## 一层里能放什么

- 任意工程文件：路径相对工程根，与骨架同名即覆盖。
- `package.patch.json`（只在层根）：深合并进产物 `package.json`。依赖表按字段合并，
  数组与标量整体取代——数组拼接会得到既非骨架也非叠加层的第三种值。
- `create.remove`（写在同一份 `package.patch.json` 里）：字符串数组，点在它之前各层里的路径
  （文件或目录，目录写不带尾斜杠也行），本层写入前先删掉它们。用来清掉换形态后不再需要的骨架文件。
- `create.unset`（写在同一份 `package.patch.json` 里）：对象，外层是 `package.json` 的字段名
  （`scripts`、`devDependencies` 等），内层是要去掉的键名数组。`create.remove` 只能删文件，
  清单里的键要靠它——比如反向叠加层摘掉 TS 创作链之后，配套的 `stories:*` 命令与创作期依赖
  也应当一起消失，否则产物里留着一个指向已删除目录、必然失败的命令。

```json
{ "create": { "remove": ["src/host", "src/styles"] } }
```

```json
{
  "create": {
    "unset": {
      "scripts": ["stories:build"],
      "devDependencies": ["@lingfan-engine/editor"]
    }
  }
}
```

新增依赖只写进 `package.patch.json`，不要复制整份 `package.json`：整份复制会让骨架后来加的字段
在这一层永久丢失。生成器会在合并之后统一查一次 registry，把依赖写成当下最新的 `^x.y.z`。

## 新增一层

1. 在 `template-meta.json` 的 `frameworks`、`sources` 或 `shells` 里加一项 `{ id, label, hint }`。
2. 建同名目录，放入该层独有的文件与 `package.patch.json`。
3. 生成器不改：它对目录是缺席即跳过，不需要为新 `id` 写分支。

一层只加自己真正需要的东西。能被骨架覆盖的差异（比如只换一个入口文件的 import）优先留在骨架里，
叠加层越多，同一处逻辑就有越多份副本要跟着改。
