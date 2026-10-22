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

The template lives at `template/v1/__PROJECT__/` in the engine repository.

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

3. Install dependencies. The template depends on `@lingfan-engine/core`, `@lingfan-engine/adapters` and `@lingfan-engine/ui`, and those three packages **are not published to a registry yet** — a plain `pnpm install` fails with a 404. Point them at the package directories in the engine repository with local links first:

   ```sh
   pnpm add @lingfan-engine/core@link:../LingFan.Engine/packages/core \
            @lingfan-engine/adapters@link:../LingFan.Engine/packages/adapters \
            @lingfan-engine/ui@link:../LingFan.Engine/packages/ui
   ```

   Adjust the paths to wherever you put the repository. All three packages publish TypeScript source entry points, so Vite compiles them directly and you never build them first.

   If `pnpm add` fails with `ERR_PNPM_IGNORED_BUILDS`, that is pnpm declining to run dependencies' build scripts by default. Approve it once in `pnpm-workspace.yaml`:

   ```yaml
   allowBuilds:
     esbuild: true
   ```

## Run it

```sh
pnpm dev
```

Vite listens on port `1420` by default. `vite.config.ts` sets `strictPort: true`, so if the port is taken it exits with an error instead of silently picking another one.

Open the address it prints and you get one line of text. Click it, or press Space.

## Change a line of dialogue

Open `Resources/Stories/title/title_main.story`. The first line is:

```text
label title_main:
  say "欢迎来到 __PROJECT__。"
```

The template's sample text is Chinese, so the line in your file looks exactly like this.

Edit that line and save. `.story` files do not go through Vite's module graph, so they do not hot-reload — the new text shows up only after you refresh the page. While you are in there, replace the leftover `__PROJECT__` too — it is only a template placeholder.

A few lines further down sits an `input`, which stores what the player types in `player.name`; the next `say` reads it back with `{player.name}`. Those are the engine's two most basic moves: write state, read state.

## Swap in a BGM

1. Drop an audio file into `Resources/Audio/`, say `Resources/Audio/theme.mp3`.
2. Add a line to the story:

   ```text
   label title_main:
     bgm "Audio/theme.mp3" volume=0.6 loop=true
     say "Music changed."
   ```

Paths are relative to `Resources/` and carry no leading slash. `volume` defaults to 1 and `loop` defaults to `true`.

Refresh the page and the music should start when the first line appears.

## Stuck? Check here

**The page is blank and the console shows a 404.** Your resource path is wrong. `bgm "Audio/theme.mp3"` maps to `Resources/Audio/theme.mp3`; paths are case-sensitive and cannot contain `..`.

**You added a story file and the engine says it cannot find the column.** The new file never made it into the story list. How the list is supplied depends on the host form: the template's pure-Web host takes files explicitly from the `STORIES` array in `src/main.ts`, so a new file has to be appended there — the template source's comment says it verbatim: 「新增故事文件必须同步此表」 (every new story file must be synced into this list):

```ts
const STORIES = ["Stories/title/title_main.story"];
```

The desktop shell does not use this table: it recursively collects every story file under `Resources/Stories/`, and anything you drop in is picked up. The engine side treats both forms the same: it only assembles files under `Stories/` and skips everything else.

**Port 1420 is taken.** Change `server.port` in `vite.config.ts`.

**You edited `project.json` and nothing happened.** The manifest is read once at startup. Restart the dev server.

## Next

- [Project Structure](/en/project-structure/): what goes in each directory and how to fill in the fields.
- [Create from a Template](/from-template/): placeholder replacement, packaging and template limits for a real project.
- [Story & Narrative Flow](/en/concepts/story/): the complete rules for columns and commands.
