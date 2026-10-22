# 叠加层

每个子目录是一层可选的工程内容，目录名就是 `template-meta.json` 里 `frameworks[]` / `shells[]` 的 `id`。
生成器按「骨架 → 框架层 → 壳层」的顺序合并，同路径文件由后一层覆盖前一层。

## 缺省项没有目录

`none`（框架无关）与 `browser`（浏览器）表示「这一层什么都不加」，所以这里看不到它们。
缺目录不是错误，只是没有内容可叠。

## 现有层

- `vue/` —— 页面结构换成单文件组件：`index.html` 变成挂载点，新增 `src/App.vue` 与 Vue 版组合根，
  `package.patch.json` 补 `vue` / `@vitejs/plugin-vue` / `vue-tsc`，并把 `typecheck` 换成
  `vue-tsc --noEmit && tsc --noEmit -p tsconfig.node.json`。`src/host/**` 一行不改，
  样式仍用骨架的 `src/styles/stage.css`。

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

新增依赖只写进 `package.patch.json`，不要复制整份 `package.json`：整份复制会让骨架后来加的字段
在这一层永久丢失。生成器会在合并之后统一查一次 registry，把依赖写成当下最新的 `^x.y.z`。

## 新增一层

1. 在 `template-meta.json` 的 `frameworks` 或 `shells` 里加一项 `{ id, label, hint }`。
2. 建同名目录，放入该层独有的文件与 `package.patch.json`。
3. 生成器不改：它对目录是缺席即跳过，不需要为新 `id` 写分支。

一层只加自己真正需要的东西。能被骨架覆盖的差异（比如只换一个入口文件的 import）优先留在骨架里，
叠加层越多，同一处逻辑就有越多份副本要跟着改。
