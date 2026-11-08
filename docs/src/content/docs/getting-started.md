---
title: 快速开始
description: 从模板生成一个工程，装依赖，跑起来，然后改一句对话、换一首 BGM，确认整条链路通了。
---

这一页带你跑到一个能玩的故事：复制目录、装依赖、改两处文件。

## 环境

Node.js ≥ 22.12（Vite 8 的下限），以及 pnpm。

```sh
node -v
pnpm -v
```

## 生成工程

```sh
npm create @lingfan-engine
```

`pnpm create @lingfan-engine`、`bun create @lingfan-engine` 等价；yarn 需 2 及以上版本，classic 用 `yarn dlx create-@lingfan-engine`。

生成器问三件事：工程名 → 描述 → 形态。工程名也可以直接写进命令：

```sh
npm create @lingfan-engine my-story
```

描述可以留空；填了会写进 `package.json` 的 `description` 与 `Resources/project.json` 的 `description`，两处是同一段文字。

形态是一次多选，按编号选，空格或逗号分隔。一次完整的问答长这样：

```text
灵泛叙事引擎 · 工程生成器

工程名：my-story
描述（可留空；会写进 package.json 与 Resources/project.json）：试菜单的小工程
形态：
  1. Vue 3 —— 页面结构换成单文件组件，装配与宿主不变  互斥：React、小程序（UniApp）
  2. React —— 页面结构换成 JSX 组件，装配与宿主不变  互斥：Vue 3、小程序（UniApp）
  3. 桌面（Tauri 2） —— 给同一份工程再加一个桌面壳：存档落到应用数据目录，页面结构不变  互斥：小程序（UniApp）
  4. 小程序（UniApp） —— 页面层换成 UniApp Vue 3 单文件组件，宿主装配走小程序端口  互斥：Vue 3、React、桌面（Tauri 2）
选择（1-4，可多选，空格或逗号分隔；回车 = 只用骨架（框架无关 + 浏览器））：1 3
```

上面这组回答生成 Vue 3 页面 + 桌面壳。组合规则只有三条：

- Vue 3 与 React 互斥，页面结构只能有一个所有者。
- 小程序（UniApp）自带 Vue 3 页面层，与 Vue 3、React、桌面壳都不能同时选。
- 桌面壳叠在浏览器形态之上，与 Vue 3 或 React 都能组合。

这一问只定页面结构与壳，不定故事怎么写。三种创作形态——TS 源（`src/Stories.src/`）、手写 `.story`、手写 `.json`——落在同一棵 `Resources/Stories/` 树上，构建时一起被扫描，可以混装在一个工程里，互不排斥。`--sources story`（或 `--template …-story`）只是额外附一份手写 `.story` 示例，不影响 TS 创作链的去留。

回车跳过形态，得到骨架原生形态：框架无关 + 浏览器。

在脚本或 CI 里跑时，加 `--yes` 取全部缺省，或用 `--description` / `--framework` / `--shell` / `--sources` 逐项给，`--template 框架[-壳[-故事源]]` 是等价写法；细节见[从模板创建工程](/from-template/)。

手工生成也可以：模板在引擎仓库的 `template/v1/__PROJECT__/`。

1. 把 `__PROJECT__/` 整个复制到你想放工程的位置，目录名改成你的工程名，比如 `my-story`。
2. 把目录里所有 `__PROJECT__` 占位符替换成同一个工程名。要改三处：目录名、`package.json` 的 `name`、`Resources/project.json` 的 `id` 和 `name`。

   ```json
   {
     "formatVersion": 1,
     "id": "my-story",
     "name": "my-story",
     "entry": "title_main",
     "lang": "zh-CN"
   }
   ```

3. 装依赖。模板依赖 `@lingfan-engine/core`、`@lingfan-engine/adapters`、`@lingfan-engine/ui`，这三个包已在 registry 上，装即可（`npm install` / `pnpm install` / `yarn` / `bun install` 都行）。生成器还会在生成时查一次最新版本写进产物；手工复制时版本是模板里记录的那个，想跟最新就自己改。

   三个包以 TypeScript 源码出口发布，Vite 直接编译，不用先构建它们。

   生成的工程自带一份 `pnpm-workspace.yaml`，里面只写 `allowBuilds`：pnpm 12 起「未批准的构建脚本」是硬错误 `ERR_PNPM_IGNORED_BUILDS`，会让整个安装失败。模板已批准 `esbuild`（Vite 与 UniApp 工具链都用它），并对不需要执行的 `core-js` 显式写 `false`——「知道了、故意不跑」与「未批准」是两回事。安装时若报别的包未批准，按提示加进这张表即可（这一节只对 pnpm 适用；用 npm / yarn / bun 时这份文件不参与，构建脚本照常执行）：

   ```yaml
   allowBuilds:
     esbuild: true
     core-js: false
   ```

## 跑起来

```sh
pnpm dev
```

（用别的包管理器就换成 `npm run dev` / `yarn dev` / `bun run dev`。）

Vite 默认监听 `1420` 端口。`vite.config.ts` 里写了 `strictPort: true`，端口被占用时它会直接报错退出，不会自动换端口。

打开提示的地址，你会看到一句话。点一下，或者按空格。

## 改一句对话

故事的源在 `src/Stories.src/title/title_main.ts`，第一列长这样：

```ts
export default function title_main(): void {
  say("这是用 TypeScript 写的故事列。", "旁白");
  say("改完保存，在工程根跑 pnpm stories:build 就会重新生成故事文件。");
  menu("接下来做什么？", [
    option("四处看看", "look_around"),
    option("重来一次", "title_main"),
  ]);
}
```

把第一句 `say` 的文字改掉，保存，在工程根跑一次 `pnpm stories:build`，再刷新浏览器。构建会把这一列编译成 `Resources/Stories/title/title_main.json`——引擎跑起来读的是那份产物，直接改 `.json` 会在下次构建时被覆盖，改源才可靠。

写状态、读状态是引擎最基本的两个动作：`input("你叫什么名字？", "player.name")` 停下来等玩家输入并存进 `player.name`，下一句 `say` 用 `{player.name}` 取出来。生成时选了 `--sources story` 的话，`Resources/Stories/manual/manual_intro.story` 里有一份手写示例把这两步写全了；手写的 `.story` 不走构建，保存即生效。

## 换一首 BGM

1. 把音频文件放进 `Resources/Audio/`，比如 `Resources/Audio/theme.mp3`。
2. 在故事列里加一行。TS 源里是：

   ```ts
   bgm("Audio/theme.mp3", { volume: 0.6, loop: true });
   say("音乐换了。");
   ```

   手写的 `.story` 里是同一件事的文本写法：

   ```text
   bgm "Audio/theme.mp3" volume=0.6 loop=true
   say "音乐换了。"
   ```

路径相对 `Resources/`，不带前导斜杠。`volume` 缺省是 1，`loop` 缺省是 `true`。

刷新页面，音乐应该在第一句话出现时响起。

## 卡住了看这里

**页面一片空白，控制台报 404。** 资源路径写错了。`bgm "Audio/theme.mp3"` 对应 `Resources/Audio/theme.mp3`，大小写敏感，路径里不能有 `..`。

**加了新故事文件，引擎说找不到列。** 先确认文件真的在 `Resources/Stories/` 下——放进去就会被扫到，清单由构建期递归扫描得出，不需要登记，也不用回来改任何名单。`src/stories/index.ts` 只是这份扫描结果的出口：

```ts
export { STORIES } from "virtual:story-list";
```

扫描与刷新在 `vite.plugins.ts` 里：dev 下新增或删除故事文件会自动作废清单并整页刷新。桌面壳走自己那套递归收集，效果一样。引擎侧对三种文件形态一视同仁：只组装 `Stories/` 下的文件，其余一律跳过。真报了找不到列，多半是文件名大小写不符，或者文件放在了 `Stories/` 之外。

**端口 1420 被占用。** 改 `vite.config.ts` 里的 `server.port`。

**改了 `project.json` 没反应。** 清单只在启动时读一次，重启 dev server。

## 下一步

- [工程结构](/project-structure/)：每个目录放什么，字段怎么填。
- [从模板创建工程](/from-template/)：正式建工程时的占位符替换、打包、模板边界。
- [故事与叙事流](/concepts/story/)：列和命令的完整规则。
