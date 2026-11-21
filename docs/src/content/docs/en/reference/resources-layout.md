---
title: Resources directory conventions
description: What goes in each directory of the resource root, how paths are written, the rules for case and dot-files, and how the editor treats this directory.
---

`Resources/` is the resource root. The manifest, stories, media, translations, and saves all live inside it, and every path written in the story is relative to it.

```
Resources/
├── project.json
├── Stories/
│   ├── title/title_main.json
│   ├── title/look_around.json
│   └── manual/manual_intro.story
├── Audio/
├── Images/
├── Video/
├── Lang/
│   └── en/main.json
└── Saves/
```

## What goes in each directory

| Directory                   | What goes there                  | How the engine reads it                                              |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `Stories/`                  | Story files (`.story` / `.json`) | Assembled into columns; the entry is set by the manifest's `entry`   |
| `Audio/` `Images/` `Video/` | Media files                      | Not scanned proactively; fetched only when a command writes the path |
| `Lang/`                     | Translation overlays             | Loaded per language by the I18N supply port                          |
| `Saves/`                    | Runtime save artifacts           | The pure Web host does not use this directory                        |

The **categorization of `Audio/` `Images/` `Video/` is a convention, not a requirement**. An image placed in `Audio/` still loads; you just write the path as `Audio/pic.png`. Splitting directories by type is so you can find things yourself.

`Saves/` in the template is the spot reserved for the desktop shell and file-system saves. The browser host writes saves into local storage, so this directory is empty (the template has only a `.gitkeep` placeholder). It should not go into version control; the template's `.gitignore` and packaging scripts both exclude it.

## How paths are written

Every resource path in the story is **relative to `Resources/`**:

```text
bgm "Audio/main.mp3"
video "Video/op.mp4"
show "Images/ache.png"
background "Images/room.png"
```

Four rules:

**No leading slash.** Writing `bgm "/Audio/main.mp3"` has the leading slash stripped — no error, but do not write it that way.

**No `..` allowed.** The path is split into segments by `/`; an empty segment or a `..` is rejected outright:

```text
Invalid resource path (escapes the resource root): ../secret.txt
```

**Case-sensitive.** `Audio/Main.mp3` and `Audio/main.mp3` are two files. On a dev machine (Windows, macOS by default) both may read, but packaged onto a Linux server it 404s. Check the case once after writing.

**Spaces and Chinese are allowed**, but a path with spaces is prone to URL-encoding mishaps; English file names with hyphens are recommended.

## Dot-files are skipped

If **any segment** of the path starts with `.`, it is a dot-file and the engine skips it:

```text
Resources/Live2D/.gitkeep       → skipped
Resources/Stories/.gitignore    → skipped
Resources/Lang/en-US/main.json  → not skipped (the name has a hyphen and a dot, but it is not a dot-file)
```

The skip exists because projects commonly have empty-directory placeholder files (`.gitkeep`). Without skipping, the engine would parse `.gitkeep` as a story file, report "no label in the text," and the whole project would fail to open.

A name like `Lang/en-US/` with `-` and `.` in it is **not** a dot-file — the criterion only looks at whether the segment **starts** with `.`.

## Stories/ is the only directory that gets assembled

When assembling the project, **only files under `Stories/` are processed**. Every other directory is skipped.

This is about **assembling the story column set**. Translations under `Lang/` do not go down this path — they are read separately by the translation supply pipeline and do not participate in assembly; the desktop shell likewise collects `Lang/` recursively (`load_i18n_overlay` at `apps/playground/src-tauri/src/project_files/overlay.rs:112`, recursing into `.json` from `:26`), so translations can sit in subdirectories of any depth without registration.

This is not an optimization; it is a correctness requirement: if `Lang/en/main.json` were parsed as a story file, it has no `formatVersion` field and would fail the whole project's assembly.

So:

- Story files go under `Stories/`, subdirectories as you like.
- Translation files go under `Lang/`.
- Do not put story files at the top level of the resource root or in `Audio/` — the engine will not look at them at all.

New story files need no registration. The engine does not read the file system — what it gets is a batch of file contents handed over by the supplier; enumerating files is the supplier's job.

The desktop shell's supplier recursively scans `Stories/`, and new files take effect directly. The template and browser forms work the same way: `vite.plugins.ts` recursively scans `Resources/Stories/` at build time and hands the result to the host as `virtual:story-list`; `src/stories/index.ts` is just the export of that scan result:

```ts
export { STORIES } from "virtual:story-list";
```

Under dev, adding or removing files in `Stories/` automatically invalidates the manifest and refreshes the whole page. A miss can only be because the file is not under `Stories/`, the extension is not `.story`/`.json`, or the case does not match the reference — in that case jumping to that column reports "target column does not exist."

## File names and column ids

File names and column ids have **no relationship**. It is perfectly legal for `Stories/chapter1/chapter1.story` to contain a column named `chapter1_start` — the file name is the chapter name, the column id is the scene name; they are two different things to begin with.

Collisions are judged by column id: two files declaring the same id report

```text
Stories/chapter2/chapter2.story: duplicate columnId: chapter1_start (conflicts with Stories/chapter1/chapter1.story)
```

When renaming a column, note that jump targets write the column id, not the file name.

## The two forms of Lang/

Translations can be placed as one big file, or split into directories by language:

```text
Resources/Lang/en.json                  ← single file, the file name is the language code
Resources/Lang/en/main.json             ← directory form, main.json is the fallback
Resources/Lang/en/chapter1.json         ← other files of the same language, overridden in path order
```

Both forms work; the supply port accepts both. In the directory form `main.json` is merged first, and the other files override in path order — so `chapter1.json` can override same-named keys in `main.json`.

The values in a translation file **must all be strings**. If even one value is not a string, the whole file is voided (not just that line skipped). This rule prevents the hard-to-track state of "half the translations take effect, half stay original."

For details see [multilingual and translations](/concepts/i18n/).

## Case and the editor

The editor's resource reconciliation uses **the real enumerated paths**, the same criterion as runtime: whatever the file is called inside `Resources/` is what the story must write. So when the editor says "resource path does not exist," it is usually a case or directory mistake.

The editor deliberately **does not read file headers to judge encryption** — knowledge of the encrypted form lives on the host side, and the projects the editor opens are all plaintext form. So it does not special-case the `.enc` suffix.

## Next steps

- [Project manifest project.json](/reference/manifest/) — `entry`, `shell.*`, and `defines` are all configured here.
- [Multilingual and translations](/concepts/i18n/) — the full rules for `Lang/`.
- [Template capability boundaries](/reference/template-boundaries/) — which capabilities the template host has wired.
