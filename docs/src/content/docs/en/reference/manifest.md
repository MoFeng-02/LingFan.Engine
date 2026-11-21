---
title: Project manifest project.json
description: Field-by-field reference for the manifest — formatVersion, capabilityVersion, id, entry, description, lang, shell.layers, shell.saves, shell.stage, shell.orientation, extensions, defines, resourceEncryption.
---

`Resources/project.json` is the project's single manifest. The engine reads it at startup; if validation fails, the whole project fails to open.

The manifest **must be inside the resource root**. Placed at the project root it runs in dev but 404s after packaging; for the reason see [project structure](/project-structure/#why-the-manifest-lives-in-resources).

## Minimal manifest

```json
{
  "formatVersion": 1,
  "id": "my-story",
  "entry": "title_main"
}
```

Three fields. Everything else can be omitted.

## Fields

| Field                | Type      | Required | Default       |
| -------------------- | --------- | -------- | ------------- |
| `formatVersion`      | `1`       | Yes      | None          |
| `capabilityVersion`  | See below | No       | Toolchain     |
| `id`                 | string    | Yes      | None          |
| `entry`              | string    | Yes      | None          |
| `name`               | string    | No       | `id`          |
| `description`        | string    | No       | None          |
| `lang`               | string    | No       | `zh-CN`       |
| `defines`            | object    | No       | Empty         |
| `shell`              | object    | No       | See below     |
| `extensions`         | string[]  | No       | No extensions |
| `resourceEncryption` | boolean   | No       | `false`       |

### formatVersion

Fixed at `1`. Writing another value reports `project.json: formatVersion must be 1, got 2`, and the whole project refuses to load.

### capabilityVersion

**Capability version**: up to which version of the authoring surface the creative toolchain that produced this artifact supports. It answers "how new a tool wrote this artifact," **not** the disk shape (that is `formatVersion`), **not** the plot version (that is the story column's `version`), and it is **not** the package's npm version.

This key is **written by the toolchain**: stamped automatically on build and editor save, with the value taken from the engine-exported constant `CAPABILITY_VERSION`, monotonically incremented by hand by the maintainers (only ever up, never down; bumped only for breaking changes). It is a managed key — **do not edit it by hand**; the next write overwrites it in place with the toolchain's value.

The read side **only reads, never validates**: missing this key still opens normally, with no downgrade and no prompt; both integers and strings are legal (new artifacts use a semantic string such as `"0.9.0"`; integers are the legal form of early artifacts). Writing it old or wrong never prevents the project from opening.

The four "versions" each govern one thing:

| Name                | Where it is written                             | What it answers                                                       |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `capabilityVersion` | `project.json` (toolchain-written)              | Up to which version the authoring surface goes                        |
| `formatVersion`     | The four formats: project / story / text / save | Which version the disk shape is (which shape the parser accepts)      |
| `version`           | Story columns and manifest managed keys         | The plot version, driving save migration                              |
| Package version     | Each `package.json`                             | The npm distribution version, **unrelated to the capability version** |

The only entry point for looking up the capability version: in TS, `import { CAPABILITY_VERSION } from "@lingfan-engine/core"`; in an artifact, look at the `capabilityVersion` key of `project.json`.

### id

The project identifier. Written into saves and compared on load — a mismatch reports "this save does not match the current story." Changing this value voids all existing saves.

### entry

The entry column id. The engine starts running from this column. If the column does not exist it reports "project.json: entry column title_main does not exist (jump targets must exist)."

It must **actually be in some story file**. Declaring `entry` but not having the corresponding column file handed over also fails to open — the engine does not read the file system, it only assembles the batch of files the supplier hands over; a file not under `Stories/` (or with mismatched case) is not scanned in, and the column effectively does not exist.

### name

The display name, used in the interface. Defaults to `id` when omitted. This value **does not participate in translation**; for an English name you must change the manifest.

### description

The project blurb, a one-liner shown to the player. Write anything; language and character set are unrestricted; an empty string is legal, and writing it or not does not affect loading.

It **does not participate in addressing**: location relies on `id` and the directory name, and title resolution only reads `name` and `id`. The description is pure meta-information; the engine changes no behavior based on it — no interface shows more or less because of it.

The description the project generator asks for is written here; the same text is written into both `package.json`'s `description` and `Resources/project.json`'s `description`. A hand-written manifest can also add this key itself.

### lang

The default language, defaulting to `zh-CN`. It is also the fallback language for translation lookup: `setLanguage("")` returns to it.

### defines

Global initial values. Written into state before the story runs; same-named definitions in story files override them.

```json
{
  "defines": { "player.gold": 7, "difficulty": "normal" }
}
```

The loading order is: the manifest's `defines` first, then story files in path code-unit order, with later same-named ones overriding earlier ones. So what the manifest writes is the "default," and what story files write is the "override."

### shell

Shell configuration. Four sub-keys:

```json
{
  "shell": {
    "layers": { "dialogue": 999, "toolbar": 1400 },
    "saves": {
      "slots": 6,
      "thumbnail": {
        "width": 320,
        "height": 180,
        "quality": 0.7,
        "showText": true
      }
    },
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
    },
    "orientation": "auto"
  }
}
```

#### shell.layers

Z-order overrides for the nine render layers. Layer names and defaults:

| Layer           | Default z | What goes there                                 |
| --------------- | --------- | ----------------------------------------------- |
| `stage`         | 0         | Background and stage elements                   |
| `video`         | 100       | Video layer. Covers the stage, not the dialogue |
| `dialogue`      | 999       | Dialogue box                                    |
| `choices`       | 1100      | The option layer of `menu` / `input`            |
| `minigame`      | 1200      | Minigames and gameplay systems                  |
| `notifications` | 1300      | The `notify` overlay                            |
| `toolbar`       | 1400      | Persistent toolbar                              |
| `history`       | 1500      | History panel                                   |
| `prefs`         | 1500      | Settings panel                                  |

The defaults leave a gap of 100 between them, to make inserting layers easy. `history` and `prefs` share a value — they are never open at the same time.

Values must be finite, non-negative numbers. Writing `-1`, `"999"`, or `NaN` is **ignored back to the default**, no error. Unknown layer names are likewise ignored.

#### shell.saves

```json
{
  "shell": {
    "saves": {
      "slots": 6,
      "thumbnail": {
        "width": 320,
        "height": 180,
        "quality": 0.7,
        "showText": true
      }
    }
  }
}
```

`slots` is the number of save slots, from 1 to 32, defaulting to 6. Slot ids are `slot_1` through `slot_N`, generated from this number. Out of range (0, 33, a fraction) is ignored back to the default.

`thumbnail` has four items: `width` 80–1280 (default 320), `height` 45–720 (default 180), `quality` 0–1 (default 0.7), `showText` boolean (default `true`). Each is validated individually; an illegal item is ignored on its own without affecting the others.

These values are **for the host to read**; the engine does not use thumbnails itself — it only reports the slot count. Thumbnails are composed by the host from a screenshot.

#### shell.stage

Stage adaptation: the author writes coordinates against a design-baseline pixel size, and the host scales the **stage** (the story picture: the element layer and extension overlays) proportionally to fit the window; the host's UI (toolbar, dialogue panel, and the like) stays in window coordinates and adapts to the window, not scaled along.

```json
{
  "shell": {
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
    }
  }
}
```

`width` / `height` are the **design baseline** (the width and height of the author's coordinate system): panels, elements, and font sizes are all written against this coordinate system; changing the baseline is equivalent to swapping the whole scene's coordinate system, with no stylesheet change. Values are 160–16384 (width) and 90–16384 (height), defaulting to 1280 × 720.

Eight built-in baselines (four each for landscape and portrait; names in `STAGE_BASELINES` of `@lingfan-engine/shell`):

| Tier  | Landscape            | Portrait    |
| ----- | -------------------- | ----------- |
| 720p  | 1280 × 720 (default) | —           |
| 1080p | 1920 × 1080          | 1080 × 1920 |
| 2K    | 2560 × 1440          | 1440 × 2560 |
| 4K    | 3840 × 2160          | 2160 × 3840 |

Low-tier portrait has an additional 750 × 1334 (a fairly common portrait baseline). These eight tiers are just a name table of common tiers; **any size within the range can be filled in** — not being in the table is equally usable.

`fit` is one of four:

| Value     | Behavior                                                                       |
| --------- | ------------------------------------------------------------------------------ |
| `contain` | Scale proportionally to show fully, letterboxing the extra direction (default) |
| `cover`   | Scale proportionally to fill, cropping the overflow                            |
| `fill`    | Stretch each axis to fill (distortion allowed)                                 |
| `none`    | No scaling, 1× as-is                                                           |

For finer control you can also give these (all optional):

- `scaleBy`: `min` / `max` / `width` / `height` / `fill`, or a positive multiplier (0.05–64). When given, it overrides the scaling strategy that `fit` expands to.
- `alignX` / `alignY`: `start` / `center` / `end`, which side to lean toward when letterboxing, defaulting to center.
- `minScale` / `maxScale`: the lower and upper bounds of scaling, each 0.05–64. When **both** are declared and `minScale > maxScale`, both are ignored together — keeping only one would yield an interval that is necessarily clamped dead or never takes effect, so it is better treated as unwritten.

Each is validated individually; an illegal item is **ignored back to the default on its own**, without affecting the others (the same criterion as `shell.saves`). These values only affect host presentation: they do not enter engine state, snapshots, or saves.

There is only one way to read this on the host side — take the result after the engine parses it; do not read the manifest yourself:

```ts
import { resolveStageConfig } from "@lingfan-engine/core";

const stage = resolveStageConfig(manifest); // built-in defaults × project overrides
```

Once you have it, hand it to the stage computation to compute the transform: `computeStageLayout(viewport, stage)` of `@lingfan-engine/shell` gives the scale and offset, and `stageTransform(layout)` gives the CSS `transform` string. The host is only responsible for measuring the viewport, applying the style, and listening for `resize` — the computation reads no platform globals, so the desktop shell, browser, and mini-program share the same criterion.

Apply it in layers: write `transform` only on the stage root, and hang the UI on sibling nodes outside the stage (window coordinates). Putting the UI inside the stage root means that when the window changes, the UI gets scaled up once more along with it — effectively changing twice with the window.

The desktop shell (`apps/playground`) and the scaffold's bundled host have both wired this layer; for the host-side specifics see [template capability boundaries](/reference/template-boundaries/). To start from "how does my game adapt to both phones and large screens," see [screen adaptation](/guides/screen-adaptation/).

#### shell.orientation

One of `auto` / `portrait` / `landscape`, defaulting to `auto`. Writing another value **errors and rejects the whole manifest** — this is the only fail-closed key in `shell`; all other illegal values are silently ignored.

```text
project.json: shell.orientation must be auto|portrait|landscape, got "vertical"
```

The priority is **player preference > project default > auto**. A player explicitly choosing `auto` (follow system) in settings overrides the author's `portrait`.

The pure Web host has no orientation API; this config only takes effect in the desktop shell and mobile shell.

### extensions

A list of host module specifiers:

```json
{ "extensions": ["./extensions/demo-quest.ts"] }
```

It must be a **non-empty string array**. Writing `[]` is wrong (either omit it entirely, or give at least one item).

Declaration-based: a module not written into this array is completely unknown to the engine. It does not scan directories or guess — this is to avoid loading arbitrary code.

For details see [extending the engine](/concepts/extensions/).

### resourceEncryption

When set to `true`, the resource root is a `.enc` encrypted package, and the engine reads it in the encrypted form. The manifest itself is **always plaintext** — this is the premise for judging the form.

This switch only declares the form; it does not specify the implementation. Where the key comes from and how the ciphertext is decrypted are not the engine's concern — all the engine wants is for the resource port's `resolve()` to return a currently usable address. Which implementation to install is decided by the composition root; the key stays in the platform layer.

So the web form can also go down this path: fetch the ciphertext, decrypt it to plaintext in the page, create a temporary address and hand it to `resolve()`; the port shape is the same as the desktop form. It is just that the template's bundled web host has not done this; it reads straight from the static root.

For what each of the three layers governs, see [encryption and platform supply](/concepts/encryption/).

## Error messages verbatim

When manifest validation fails, all problems are reported at once, each prefixed with `project.json:`:

```text
project.json: formatVersion must be 1, got 2
project.json: id must be a non-empty string
project.json: entry must be a non-empty string (entry column)
project.json: defines must be an object
project.json: name must be a string
project.json: lang must be a string
project.json: extensions must be a non-empty string array (host module specifiers)
project.json: shell must be an object
project.json: shell.orientation must be auto|portrait|landscape, got "vertical"
```

All field-level problems are listed before rejecting; it does not report one and stop at one. Fix them and load again.

The existence of `entry` is checked separately after field validation:

```text
project.json: entry column title_main does not exist (jump targets must exist)
```

## Opening without a manifest

When there is no `project.json` in the resource root, the engine synthesizes a degraded manifest, using the resource-root directory name as `id` and the first column in path code-unit order as `entry`, and gives the reason:

```text
project.json not found; opened in degraded mode with the first column in order, "title_main" (the manifest is written to disk after saving)
```

This is a fallback for the "author just lays down story files" scenario. **Only the missing-manifest case is degraded** — a manifest that exists but has a wrong format is still rejected.

When there is not a single parseable column, it reports:

```text
Degraded open failed: resource root "my-story" lacks project.json, and there is no parseable column under Stories/ — nothing to open
```

When there is no content to open, pretending it can open is lying.

## Next steps

- [Resources directory conventions](/reference/resources-layout/) — what goes in each directory, how paths are written.
- [Save system](/concepts/saves/) — the relationship between `slots` and slot ids.
- [Template capability boundaries](/reference/template-boundaries/) — which `shell.*` the template host consumes.
