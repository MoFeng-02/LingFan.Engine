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
npm create @lingfan-engine my-story
```

也可以用 `pnpm create @lingfan-engine my-story`，两者等价。生成器会问工程名、框架与壳，全部取缺省值加 `--yes`。

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

3. 装依赖。模板依赖 `@lingfan-engine/core`、`@lingfan-engine/adapters`、`@lingfan-engine/ui`，这三个包已在 registry 上，`pnpm install` 直接可用。生成器还会在生成时查一次最新版本写进产物；手工复制时版本是模板里记录的那个，想跟最新就自己改。

   三个包以 TypeScript 源码出口发布，Vite 直接编译，不用先构建它们。

   如果 `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS`，是 pnpm 默认不跑依赖的构建脚本。在 `pnpm-workspace.yaml` 里批准一次：

   ```yaml
   allowBuilds:
     esbuild: true
   ```

## 跑起来

```sh
pnpm dev
```

Vite 默认监听 `1420` 端口。`vite.config.ts` 里写了 `strictPort: true`，端口被占用时它会直接报错退出，不会自动换端口。

打开提示的地址，你会看到一句话。点一下，或者按空格。

## 改一句对话

打开 `Resources/Stories/title/title_main.story`，第一行是：

```text
label title_main:
  say "欢迎来到 __PROJECT__。"
```

把这句改掉，保存，然后刷新浏览器——`.story` 不走 Vite 的模块图，不会触发热更新，新内容在刷新后才出现。顺手把残留的 `__PROJECT__` 也换掉——它只是模板占位符。

再往下几行有一句 `input`，它把玩家输入存进 `player.name`，下一条 `say` 用 `{player.name}` 取出来。这是引擎最基本的两个动作：写状态、读状态。

## 换一首 BGM

1. 把音频文件放进 `Resources/Audio/`，比如 `Resources/Audio/theme.mp3`。
2. 在故事里加一行：

   ```text
   label title_main:
     bgm "Audio/theme.mp3" volume=0.6 loop=true
     say "音乐换了。"
   ```

路径相对 `Resources/`，不带前导斜杠。`volume` 缺省是 1，`loop` 缺省是 `true`。

刷新页面，音乐应该在第一句话出现时响起。

## 卡住了看这里

**页面一片空白，控制台报 404。** 资源路径写错了。`bgm "Audio/theme.mp3"` 对应 `Resources/Audio/theme.mp3`，大小写敏感，路径里不能有 `..`。

**加了新故事文件，引擎说找不到列。** 新文件没进故事清单。故事清单按宿主形态分两种：模板这套纯 Web 宿主按 `src/main.ts` 里 `STORIES` 数组显式取文件，新文件要追加进去——模板源码里的注释原话就是「新增故事文件必须同步此表」：

```ts
const STORIES = ["Stories/title/title_main.story"];
```

桌面壳不走这张表，它递归收集 `Resources/Stories/` 下所有故事文件，放了就认。引擎侧两种形态一致：只组装 `Stories/` 下的文件，其余一律跳过。

**端口 1420 被占用。** 改 `vite.config.ts` 里的 `server.port`。

**改了 `project.json` 没反应。** 清单只在启动时读一次，重启 dev server。

## 下一步

- [工程结构](/project-structure/)：每个目录放什么，字段怎么填。
- [从模板创建工程](/from-template/)：正式建工程时的占位符替换、打包、模板边界。
- [故事与叙事流](/concepts/story/)：列和命令的完整规则。
