---
title: Project Structure
description: A LingFan project is a host shell around a Resources/ root. Manifest, stories, media and translations live under Resources/, and every path is relative to it.
---

A project is two halves: the host shell outside (build config, HTML, composition root) and the `Resources/` root inside (manifest, stories, media, translations, saves).

```
my-story/
├── package.json
├── tsconfig.json
├── vite.config.ts        # publicDir: "Resources"
├── index.html            # stage DOM skeleton
├── src/main.ts           # composition root
└── Resources/            # resource root
    ├── project.json      # project manifest
    ├── Stories/
    ├── Audio/
    ├── Images/
    ├── Video/
    ├── Lang/{lang}/
    └── Saves/
```

## Why the manifest lives in Resources/

`Resources/` doubles as Vite's static root (`publicDir: "Resources"` in `vite.config.ts`), so dev and production serve assets from the same root. Leave the manifest at the project root and Vite reads it fine in dev, while the packaged build 404s on it.

For the same reason, resource paths in stories are relative to `Resources/`: `bgm "Audio/main.mp3"` means the file `Resources/Audio/main.mp3`. Paths take no leading slash, cannot contain `..`, and are case-sensitive.

## project.json

`Resources/project.json` is the project's only manifest. The engine reads it at startup.

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "name": "My Story",
  "entry": "title_main",
  "lang": "zh-CN"
}
```

| Field | Required | Meaning |
|---|---|---|
| `formatVersion` | Yes | Fixed at `1`. Any other value is refused outright. |
| `id` | Yes | Project identifier. Written into saves, and checked on load to confirm the save belongs to this project. |
| `entry` | Yes | Entry column id. The engine starts here; if the column does not exist the whole project fails to load. |
| `name` | No | Display name. Falls back to `id`. |
| `lang` | No | Default language, `zh-CN` when omitted. The I18N overlay layer looks up translations by it. |

Beyond those four there are a few optional fields you will rarely touch:

| Field | Meaning |
|---|---|
| `shell.layers` | Z-order overrides for the nine layers, e.g. `{"dialogue": 999}`. |
| `shell.saves.slots` | Save slot count, 1 to 32, 6 by default. |
| `shell.saves.thumbnail` | Thumbnail dimensions and quality. |
| `shell.orientation` | `auto` / `portrait` / `landscape`. A plain web host has no orientation API, so only the desktop shell acts on it. |
| `extensions` | List of host module specifiers, e.g. `["ext/demo.ts"]`. |
| `defines` | Global initial values. A definition of the same name in a story file overrides it. |
| `resourceEncryption` | When `true`, the resource root is an encrypted `.enc` bundle. The manifest itself always stays plaintext. |

## Stories/

Story files. Both forms can sit side by side:

- `.story` text files — use these when writing by hand.
- `.json` JSON v1 — use these for tool-generated, machine-read content.

Put them anywhere inside `Stories/`, in whatever subdirectories you like. Column ids are unique across the whole project. File names are unrelated to column ids; collisions are decided by column id.

How a new file gets into the story list depends on the host form:

- **Template host (pure-Web form)**: files are taken explicitly from the `STORIES` array in `src/main.ts`; a new file has to be appended there:

  ```ts
  const STORIES = ["Stories/title/title_main.story"];
  ```

- **Desktop shell**: recursively collects every story file under `Resources/Stories/` — drop one in and it is picked up, no registration needed; subdirectories double as chapter grouping.

The engine side is the same for both forms: the assembler only processes files under `Stories/` and skips every other path. A file that never made the list (a missed registration in the Web form) has no columns at all, so jumping to one of them fails to load with "target column does not exist".

## Audio/ Images/ Video/

Media files. The split is a convention, not a rule — an image under `Audio/` still loads, you just write the path as `Audio/pic.png`. Grouping by type is for your own convenience.

## Lang/{lang}/

Translation overlay. JSON files under `Lang/en-US/` override interface text by "source text → translation":

```text
Resources/Lang/en-US/main.json
```

```json
{
  "欢迎来到我的故事。": "Welcome to my story."
}
```

The key is the source string, written exactly as it appears in your story — the sample project's source language is Chinese, so the keys are Chinese. With no I18N provider layer wired up, translations are never loaded and the source text shows as-is.

## Saves/

A runtime artifact. Saves go to browser local storage or wherever the host keeps them; the `Saves/` directory is just a location reserved for the desktop shell and filesystem saves. It does not belong in version control, and the template's `.gitignore` and packaging script both exclude it.

## Host shell

`index.html` is the stage skeleton: containers like `#stage`, `#dialogue`, `#choices`, `#notifications` and `#toolbar`. `src/main.ts` is the composition root, doing four things in a fixed order: wire up adapters, load and assemble the project, construct the engine, subscribe the renderer and frame loop.

The order matters: layer z-order is resolved before being written into the DOM, the video layer needs that z-order before it can be built, and slots must be filled before the engine is constructed. Follow that order when you change the host.

The host depends on no UI framework and manipulates the DOM directly. Moving to Vue or React touches only `src/main.ts` and `index.html`; the engine and adapters stay put.

## Next

- [Create from a Template](/en/from-template/): placeholder replacement, packaging, and where the template stops.
- [Story & Narrative Flow](/en/concepts/story/): how columns and commands are organised.
- [Multilingual Stories](/en/concepts/i18n/): the complete rules for `Lang/`.
