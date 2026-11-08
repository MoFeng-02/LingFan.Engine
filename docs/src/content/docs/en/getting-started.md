---
title: Quick Start
description: Generate a project from the template, install dependencies, run it, then change one line of dialogue and swap in a BGM to confirm the whole chain works.
---

This page gets you to a story you can actually play: copy a directory, install dependencies, edit two files.

## Requirements

Node.js ≥ 22.12 (the floor Vite 8 sets) and pnpm.

```sh
node -v
pnpm -v
```

## Generate a project

```sh
npm create @lingfan-engine
```

`pnpm create @lingfan-engine` and `bun create @lingfan-engine` work the same way. yarn needs version 2 or later; on classic, write `yarn dlx create-@lingfan-engine`.

The generator asks three things: project name, description, then shape. You can also pass the name on the command line:

```sh
npm create @lingfan-engine my-story
```

The description may be left empty. If you fill it in, it goes into both `package.json` and `Resources/project.json` as `description`.

Shape is a multi-select answered by number, separated by spaces or commas. A full exchange looks like this:

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

That answer gives you Vue 3 pages inside a desktop shell. The combination rules are three:

- Vue 3 and React are mutually exclusive — page structure can have only one owner.
- The miniprogram (UniApp) shape brings its own Vue 3 page layer, so it conflicts with Vue 3, React and the desktop shell.
- The desktop shell sits on top of the browser shape and combines with either Vue 3 or React.

This question only picks page structure and shell — not how stories are written. The three authoring forms — TypeScript sources (`src/Stories.src/`), hand-written `.story`, hand-written `.json` — live in the same `Resources/Stories/` tree and are scanned together at build time, so they can be mixed in one project and never exclude each other. `--sources story` (or `--template …-story`) just adds a hand-written `.story` sample on top; it does not decide whether the TypeScript authoring chain stays.

Press Enter to skip the question and you get the skeleton's native shape: framework-agnostic + browser.

In scripts and CI, pass `--yes` to take every default, or pin each part with `--description` / `--framework` / `--shell` / `--sources`. `--template framework[-shell[-sources]]` is the compact equivalent; see [Create from a Template](/from-template/).

Generating by hand works too. The template lives at `template/v1/__PROJECT__/` in the engine repository.

1. Copy the whole `__PROJECT__/` directory wherever you want the project, and rename it to your project name, say `my-story`.
2. Replace every `__PROJECT__` placeholder inside the directory with that same name. Three places need it: the directory name, `name` in `package.json`, and `id` plus `name` in `Resources/project.json`.

   ```json
   {
     "formatVersion": 1,
     "id": "my-story",
     "name": "my-story",
     "entry": "title_main",
     "lang": "zh-CN"
   }
   ```

3. Install dependencies. The template depends on `@lingfan-engine/core`, `@lingfan-engine/adapters` and `@lingfan-engine/ui`, all of which are on the registry, so any package manager works (`npm install`, `pnpm install`, `yarn`, `bun install`). The generator also queries the registry once at generation time and writes the latest versions into the output; when copying by hand the versions are the ones recorded in the template — bump them yourself if you want the newest.

   All three packages publish TypeScript source entry points, so Vite compiles them directly and you never build them first.

   If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, that is pnpm declining to run dependencies' build scripts by default; since pnpm 12 it is a hard error that aborts the whole install. Generated projects ship a `pnpm-workspace.yaml` that only declares `allowBuilds`: `esbuild` is approved (Vite and the UniApp toolchain rely on it) and `core-js` is explicitly `false` — "known, deliberately skipped" is a different state from "not approved". If some other package is reported, add it to that table (this section only applies to pnpm; with npm / yarn / bun the file is ignored and build scripts run as usual):

   ```yaml
   allowBuilds:
     esbuild: true
     core-js: false
   ```

## Run it

```sh
pnpm dev
```

(With another package manager use `npm run dev`, `yarn dev` or `bun run dev`.)

Vite listens on port `1420` by default. `vite.config.ts` sets `strictPort: true`, so if the port is taken it exits with an error instead of silently picking another one.

Open the address it prints and you get one line of text. Click it, or press Space.

## Change a line of dialogue

The story source lives in `src/Stories.src/title/title_main.ts`. The first column looks like this:

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

The template's sample text is Chinese, so the strings in your file look exactly like this. Edit the text of the first `say`, save, run `pnpm stories:build` in the project root, then refresh the page. The build compiles this column to `Resources/Stories/title/title_main.json` — that artifact is what the engine reads at runtime, so editing the `.json` directly gets overwritten by the next build. Edit the source.

Writing state and reading it back are the engine's two most basic moves: `input("What's your name?", "player.name")` stops and stores what the player types in `player.name`, and the next `say` reads it back with `{player.name}`. If you generated the project with `--sources story`, `Resources/Stories/manual/manual_intro.story` contains a hand-written sample that does both; hand-written `.story` files skip the build and take effect on save.

## Swap in a BGM

1. Drop an audio file into `Resources/Audio/`, say `Resources/Audio/theme.mp3`.
2. Add a line to the story column. In a TypeScript source that is:

   ```ts
   bgm("Audio/theme.mp3", { volume: 0.6, loop: true });
   say("Music changed.");
   ```

   The same thing written as text in a hand-written `.story` file:

   ```text
   bgm "Audio/theme.mp3" volume=0.6 loop=true
   say "Music changed."
   ```

Paths are relative to `Resources/` and carry no leading slash. `volume` defaults to 1 and `loop` defaults to `true`.

Refresh the page and the music should start when the first line appears.

## Stuck? Check here

**The page is blank and the console shows a 404.** Your resource path is wrong. `bgm "Audio/theme.mp3"` maps to `Resources/Audio/theme.mp3`; paths are case-sensitive and cannot contain `..`.

**You added a story file and the engine says it cannot find the column.** First check that the file really is under `Resources/Stories/` — anything you put there is picked up, because the list is produced by a build-time scan. There is no registration step and no list to hand-edit; `src/stories/index.ts` is only the exit for that scan:

```ts
export { STORIES } from "virtual:story-list";
```

The scan and its dev-time refresh live in `vite.plugins.ts`: adding or removing a story file invalidates the list and reloads the page. The desktop shell does its own recursive collection and behaves the same. The engine side treats all three file forms identically: it only assembles files under `Stories/` and skips everything else. If it still cannot find the column, the usual causes are a case mismatch in the file name, or the file sitting outside `Stories/`.

**Port 1420 is taken.** Change `server.port` in `vite.config.ts`.

**You edited `project.json` and nothing happened.** The manifest is read once at startup. Restart the dev server.

## Next

- [Project Structure](/en/project-structure/): what goes in each directory and how to fill in the fields.
- [Create from a Template](/from-template/): placeholder replacement, packaging and template limits for a real project.
- [Story & Narrative Flow](/en/concepts/story/): the complete rules for columns and commands.
