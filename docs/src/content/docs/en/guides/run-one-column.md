---
title: Running a single column
description: Jump straight to a column in the story during development — pass a column id to the dev command, skip the start page and enter that column, and first check whether this stretch plays through on its own.
---

The most time-consuming part of writing a story is often not the writing but "change one line → restart → walk ten minutes to reach that line". The run-one-column channel exists for exactly this: pass a column id to the dev command, skip the start page, and enter that column directly.

## One command

Run at the project root:

```sh
pnpm dev --story-name inn
```

When the browser opens you are already in the `inn` column.

(With another package manager, adjust the spelling; **npm must use `--` as a separator**, otherwise it swallows `--story-name` as its own option:)

```sh
npm run dev -- --story-name inn
yarn dev --story-name inn
bun run dev --story-name inn
```

Without this argument the behavior is completely unchanged — it still starts from the start page as usual.

## The value is a column id, not a file name

What follows `--story-name` is a **column id**, not a file name. The two often differ: the column whose file name is `stage-demo.json` has the id `stage_demo` (underscore, because an id is an identifier and cannot use a hyphen). Column ids are unique within the project and may span files. A single file can also hold multiple columns (especially common for text-form `.story` files); in that case the file name only matches the first column, and the ids of the rest must be read from the column declarations inside the file.

If you are unsure which columns exist, list them first:

```sh
pnpm dev --list-entries
```

The output is one column id per line with the file it lives in:

```
inn	Stories/chapter1/inn.json
start	Stories/chapter1/start.json
square	Stories/chapter2/square.json
stage_demo	Stories/chapter2/stage-demo.json
```

Column ids are unique across the whole project; the same id appearing in two files is an accident, and running that column reports an error directly and lists both candidate files — it does not pick one for you.

## Prerequisite: the story artifacts are fresh

This channel reads the compiled story artifacts (the files under `Resources/Stories/`), not the source. If you changed the source without recompiling, you still run the old content.

```sh
pnpm stories:build
pnpm dev --story-name inn
```

When the artifact directory is empty, the command tells you "no story files found" and gives the directory path; if some file fails to parse, the command includes that file's path to tell you which one is broken — it does not silently skip.

## What gets left out

The direct jump first runs the entry column once, then jumps to the column you specified. **The entry column's first line of dialogue and the commands after it do not execute.**

What already took effect is preserved: numeric adjustments, character entrances, UI mounts, and background music that the entry column did before its first line of dialogue are all still there.

So if your entry column has important initialization before its first line of dialogue, it takes effect as usual on a direct jump; the part after the dialogue does not run.

Another known limitation: after entering that column, pressing "restart" returns to the entry column, not to the column you were just in.

## Desktop form

The desktop dev command accepts this argument too:

```sh
pnpm tauri dev --story-name inn
```

It goes through the same channel; the chapter id is passed to the dev server in the desktop chain via an environment variable, which then hands it to the page.

## Scaffold artifacts have this channel too

Projects created with the generator support it as well: the dev command first reads the compiled story artifacts in the project, lists the columns, then jumps by column id.

```sh
npm run dev -- --story-name title_main
```

The template project ships with two example columns (`title_main` and `look_around`), so you can try it without compiling the story first.

The miniprogram form is not included: its dev command is managed by the miniprogram toolchain, and the argument form differs from here.

## Wiring it into your own host

The channel is short: pass the column id to the page via an environment variable, and the page enters that column directly once it reads it. The engine already supports "jump to a specified column"; no engine change is needed.
