---
title: Introduction
description: Framework-agnostic TypeScript narrative engine. Stories are text files; the engine advances the plot, tracks state, saves, rolls back. The interface is yours.
---

LingFan Engine is a framework-agnostic TypeScript narrative engine. Stories are text files, and the engine's job is to run them: advance the plot, track state, save, roll back. The interface is not the engine's business — the same story runs under a different renderer without editing the story or the engine.

## One story file

`Resources/Stories/title/title_main.story`:

```text
label title_main:
  say "Welcome to my story."
  input "What's your name?" store="player.name"
  say "Hello, {player.name}!"
  menu "What next?"
    "Set off" -> chapter_one
    "Again" -> title_main

label chapter_one:
  say "Chapter one begins."
```

`label` opens a column, and commands go inside it in order. `say` shows a line; `input` stops and waits for the player, storing what they type in `player.name`; `menu` offers choices that jump to other columns. This runs as-is inside a template project.

## What the engine does

It executes commands in order, stopping at a **wait point** until the player acts. Dialogue, choices, input, cutscene video and minigames are all wait points. Play resumes from where it left off.

Variables written by `set`, `array` and `dict` travel with saves and rollbacks. Loading a save does not replay the story from the beginning — it restores the coordinate and state recorded at save time.

A save stores a coordinate plus state, not the story text. Rollback returns to any earlier dialogue point, and the history panel reads that same data.

Translations live under `Lang/{lang}/`, and a missing translation falls back to the original text.

## What the engine doesn't do

Layout, typography, animation curves, save panels and settings screens all belong to the presentation layer. The engine emits state and events; drawing them is your call. The template's host manipulates the DOM directly and depends on no UI framework — switching to Vue or React means editing only those host files.

The engine is not tied to an editor. Stories are plain text, so write them in whatever editor you like. The repository also ships a separate editor app (`pnpm editor`) built around a project asset browser; it is still evolving.

## Three layers

| Layer        | Package             | Responsibility                                                           |
| ------------ | ------------------- | ------------------------------------------------------------------------ |
| Core         | `@lingfan/engine`   | Parses stories, executes commands, holds state, saves and rollback       |
| Adapters     | `@lingfan/adapters` | Preset implementations for audio, video, assets and saves                |
| Presentation | `@lingfan/ui`       | Reference implementations of dialogue box, choices and element rendering |

The three packages in the table above plus the editor app package `@lingfan/editor` — four engine packages (engine / adapters / ui / editor) — all publish TypeScript source (`exports: "./src/index.ts"`), compiled directly by Vite/TS with no intermediate build step (see [Template & package boundaries](/en/reference/template-boundaries/)).

## Next

- [Quick Start](/en/getting-started/): get a playable story running from the template.
- [Project Structure](/en/project-structure/): what goes in `Resources/` and how to configure `project.json`.
- [Story & Narrative Flow](/en/concepts/story/): the full rules for columns, commands and jumps.
