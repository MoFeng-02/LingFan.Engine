---
title: Create a project from the template
description: The template provides a project skeleton and a runnable example story. The host it ships has wired capabilities with boundaries — before using it, see clearly what the template has not wired and what the engine does not have.
---

The template lives in the engine repository at `template/v1/`. `__PROJECT__/` is the project skeleton, `overlays/` are the stackable layers, `README.md` is the template's own documentation, `pack-template.ps1` handles packaging, and `template-meta.json` records the template version and the options.

## Generate a new project

```sh
npm create @lingfan-engine my-story
pnpm create @lingfan-engine my-story
```

The generator asks three things: project name, description, and shape. If the project name is on the command line, that question is skipped; the description can be left empty, and if filled it is written to both `package.json`'s `description` and `Resources/project.json`'s `description`.

The shape is a multi-select, numbered as follows:

| Number | Shape                 | What you get when selected                                                                                    |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1      | Vue 3                 | The page structure becomes single-file components; assembly and host unchanged                                |
| 2      | React                 | The page structure becomes JSX components; assembly and host unchanged                                        |
| 3      | Desktop (Tauri 2)     | Adds a desktop shell on the same project: saves go to the app data directory, page structure unchanged        |
| 4      | Mini program (UniApp) | The page layer becomes UniApp Vue 3 single-file components; host assembly goes through the mini-program ports |

Answer by number, separated by spaces or commas, e.g. `1 3`. Press Enter to skip all and get the skeleton's native shape: framework-agnostic + browser.

Combination rules:

- Vue 3 and React are mutually exclusive: the page structure can have only one owner.
- The mini program (UniApp) brings its own Vue page layer and is mutually exclusive with Vue 3, React, and the desktop shell.
- The desktop shell stacks on top of the browser shape and combines with either Vue 3 or React; selecting it alone also works, giving native pages + desktop shell.

This question only decides the page structure and shell, not how the story is written. The story has three authoring forms, all landing on the same `Resources/Stories/` tree, scanned together at build time, and **they can be mixed in one project**:

| Authoring form        | Where it is written            | How a change takes effect |
| --------------------- | ------------------------------ | ------------------------- |
| TS source             | `src/Stories.src/**/*.ts`      | Run a build               |
| Hand-written `.story` | `Resources/Stories/**/*.story` | Effective on save         |
| Hand-written `.json`  | `Resources/Stories/**/*.json`  | Effective on save         |

The three do not exclude each other: the skeleton ships the TS-source chain (type completion, refactoring, reuse of the TS ecosystem, compiled to `.json` at build time), while hand-written `.story` and `.json` can be added to the same `Resources/Stories/` at any time without dismantling the TS chain. The only hard constraint is that column `id`s are unique across the project — columns in different files can coexist as long as their ids do not collide.

`--sources story` (and `--template …-story`) therefore means "additionally attach a hand-written `.story` example"; it does not change whether the TS authoring chain stays.

After generation, follow the prompts to enter the directory, install dependencies, and run. The generator does not install dependencies by default; add `--install` to do it in one step.

### Scripts and CI

In a script you need not answer the questions: use parameters to fix all three and skip the interaction.

```sh
npm create @lingfan-engine my-story --description "A small project to try menus" --framework vue --shell tauri
```

`--framework` takes `none` / `vue` / `react`, `--shell` takes `browser` / `tauri` / `miniprogram`. Any dimension left out takes that dimension's default; parameter mode does not do exclusivity validation — the combination is the script's own responsibility. `--sources` takes `ts` / `story`: `story` additionally attaches a hand-written `.story` example, `ts` is the skeleton's own shape.

`--template` is the compact form of the same thing, written `framework[-shell[-story-source]]`:

```sh
npm create @lingfan-engine my-story --template vue-tauri
npm create @lingfan-engine my-story --template react-browser
npm create @lingfan-engine my-story --template none-miniprogram
npm create @lingfan-engine my-story --template none-browser-story
```

Shape selection is governed by the questions; `--template` is left for existing scripts.

To take all defaults (native + browser, no extra story example) use `--yes`, which asks no questions at all.

> The examples above are written for pnpm / bun pass-through behavior. npm first parses switches against its own config options (`--yes` is one), so add the separator `--` before the first option: `npm create @lingfan-engine my-story -- --yes`.

The framework layer only swaps the page structure and entry: choosing Vue 3 replaces `index.html` with a mount point and adds `src/App.vue` and the Vue composition root; choosing React swaps in `src/App.tsx` and the React composition root; neither touches `src/host/**` (assembly, subscriptions, frame loop, input mapping) — the engine and adapters know no UI framework. Both shapes share the same stylesheet `src/styles/stage.css`.

The shell layer comes in two kinds: the desktop shell only adds a desktop outer layer, keeping the page structure and host as-is, so it can stack on Vue 3 or React; the mini-program shell replaces the entire page and host, with the page structure carried by `src/components/**` and host assembly in `src/mp/**` (platform APIs appear in only one place), content not bundled but fetched from the project API by base address. Its `vite` and `vue` are a set of versions pinned by the UniApp plugin, declared retained by the overlay, not participating in "follow latest."

How the story is written is unrelated to that question — the trade-offs of the three authoring forms are in the table above, and the writing details are in [TS authoring mode](/advanced/ts-story-source/). When mixing, there are three general cautions:

- Column `id`s are unique across the project: columns in different files coexist as long as ids do not collide; a collision reports the two conflicting sources at build time.
- The `.json` written by the build in the output directory `Resources/Stories/**` is maintained by the build itself — the build only cleans up files it wrote last round and no longer produces this round; it does not touch your hand-written `.story` and `.json`. So editing the TS source is more reliable than editing the `.json` it generates.
- Type checking uses a separate `tsconfig.stories.json`, apart from the framework layer's `tsconfig.json`: story sources have ambient globals like `state`, which should not be mixed with the page code's DOM type surface in one project.

The project name allows only lowercase letters, digits, `-`, `_`, and cannot start with an underscore or dot — it goes into `package.json`'s `name`, `Resources/project.json`'s `id`, and the directory name; uppercase and dot-leading are invalid on the npm side.

There are two things the generator does for you that are easy to miss when copying the directory by hand:

- **Whole-placeholder replacement**: both `__PROJECT__` and `__project__` forms are replaced (the latter is `package.json`'s name and must be lowercase). Miss one and the package name and manifest `id` will not match.
- **Engine package versions take the current latest**: at generation it queries the registry once and writes the latest version as `^x.y.z`. It does not write the `latest` tag, because that resolves to the then-highest version on every install, so the same project would install different versions on two machines. The few packages upstream is not yet compatible with (currently `typescript` — `vue-tsc` crashes on 7) are declared retained by the overlay at the template's recorded range, not following latest.

The project's own `pnpm-workspace.yaml` does only one thing: declare `allowBuilds`. Since pnpm 12, "unapproved build scripts" is a hard error that fails `pnpm install` entirely; the template has approved `esbuild` and explicitly written `false` for `core-js` ("acknowledged, deliberately not run" is not the same as "unapproved"). When another package is reported, add a line as prompted.

## How the template is organized

`template/v1/__PROJECT__/` is the framework-agnostic skeleton, and `template/v1/overlays/<id>/` are the overlay layers. Overlay rules: same-path files override the skeleton, and root-level `*.patch.json` deep-merges into `package.json`.

`template-meta.json`'s `frameworks` / `shells` declare which options exist; each `id` corresponds to an overlay directory; the defaults (`none` / `browser`) have no directory, meaning that layer adds nothing. `sources` is also kept in the manifest but does not participate in the shape questions — it declares how the story example is attached: the default `ts` has no directory (the whole authoring chain is already in the skeleton), `story` has a directory and only additionally attaches a hand-written `.story` example, removing no skeleton files. The merge order is fixed as "skeleton → framework → story source → shell": story source comes after the framework layer, and the shell goes last because it has the final say on the project shape (the mini-program shell deletes the skeleton's `src/host`).

`.gitignore` is stored in the template as dotless `gitignore`: when npm installs the package into `node_modules` it renames the package's `.gitignore` to `.npmignore`, so storing it under the original name would leave the generated project both missing ignore rules and carrying a useless file.

## The example story

The skeleton ships a TS-source example: two columns in `src/Stories.src/title/*.ts` (`title_main` and `look_around`), compiled to `Resources/Stories/title/*.json` and delivered with the skeleton. The hand-written example additionally attached by `--sources story` is at `Resources/Stories/manual/manual_intro.story`, with column ids all in the `manual_` namespace so they do not collide with the skeleton's two columns; it demonstrates several things:

```text
scene manual_intro type=ui
  say "This part comes from Resources/Stories/manual/manual_intro.story."
  say "Text stories, hand-written JSON, and TS source can be mixed under Resources/Stories/ at the same time; column ids just need to be unique across the project."
  menu "Where to next?"
    "See dialogue and input" -> manual_talk
    "See stage elements" -> manual_stage

scene manual_talk
  input "First, a question: what's your name?" store="player.name"
  say "Hello, {player.name}!"
  say "This column is a game column: from here on, every step is rollbackable and saveable."
  menu "Where to next?"
    "See stage elements" -> manual_stage
    "Back to the start of this column" -> manual_talk

scene manual_stage
  panel x=5% y=10% width=90% zindex=10
    text "A scene column = a declarative spatial layer: these blocks are elements, not dialogue"
    text "panel is a container; child elements are written with deeper indentation"
  say "Entering a scene column: elements are loaded as a whole (review/load will follow automatically)."
  say "The next line hides the dialogue box, and the one after brings it back."
  window hide
  say "(The dialogue box is hidden — click to continue)"
  window show
  say "The dialogue box is back. For project configuration like layers and save slots, see the boundary table in the README."
```

A `type=ui` column does not enter history, does not enter saves, and builds no checkpoints — it is interface, not plot; the engine only renders such columns per op.
The same three columns written in TS take the form in `src/Stories.src/title/*.ts`, producing same-named `.json` — both forms compile to the same runtime structure.

When switching to your own story, just delete these example columns; you can also keep them and add your own files alongside.

## What the template ships

The template's host depends on no UI framework and operates the DOM directly. It has wired these:

| Capability                                                                 | Status                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Dialogue layer (typewriter, `{p}` `{w}` pauses, style marks)               | Wired                                                               |
| Waiting-state exits: `menu` / `input` / `wait` / `video`                   | Wired                                                               |
| Waiting state: `minigame`                                                  | Wired, but shows an "unregistered" prompt, does not fake completion |
| Stage element layer (36 element types + interaction + 12 presentation ops) | Wired, including frame-driven                                       |
| Layer z-order (`shell.layers`)                                             | Wired                                                               |
| Save slots (`shell.saves.slots`)                                           | Wired                                                               |

The play interface's text is **not selectable** by default (`user-select: none` on `body`): dragging, rapid clicking, and double-clicking should not leave a selection on lines or buttons. To provide copy capability, add `data-lf-selectable` to that widget to allow it — the input box is already allowed, otherwise the `input` op could not select words to edit.

## What the template has not wired

The "not wired" entries in this table are all **the template host has not written them**, not that the engine lacks them. The upgrade path is `apps/playground` — it is also the template's first instance.

| Capability                                       | Why it is absent                                                                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save thumbnails                                  | The template's saves do not pass a screenshot, so the saved file has no thumbnail.                                                                                                                                                          |
| History panel and rollback UI                    | The engine-side interfaces are complete; the template has not built the panel.                                                                                                                                                              |
| Player preferences panel (volume, text speed)    | When unwired, volume takes the value written in the op, and typewriter speed takes the story-level `text_typewriter`.                                                                                                                       |
| I18N supply                                      | When `i18nPort` is unwired, the original text is output directly. Translations in the `Lang/` directory are not read.                                                                                                                       |
| Dialogue template registration (`say template=`) | When unwired, the built-in default skeleton is used.                                                                                                                                                                                        |
| Screen orientation lock (`shell.orientation`)    | Pure Web has no orientation API; this only takes effect in the desktop shell.                                                                                                                                                               |
| Stage adaptation (`shell.stage`)                 | The template host is a fixed-viewport layout and has not wired scaling adaptation. To wire: take the result of `resolveStageConfig` and compute the transform with `@lingfan-engine/shell`'s `computeStageLayout`.                          |
| Resource encryption                              | The template host mounts a static resource root and fetches files directly by path. Encryption requires the platform layer to decrypt before giving the address; see [Encryption and platform supply](/concepts/encryption/) for the chain. |
| Hot reload                                       | Triggered by watching the source resource root; the pure Web shape has no file-system watching.                                                                                                                                             |
| Host information                                 | The template host does not read the runtime platform; desktop and mobile go through the same set. Platform facts are only needed for a few resource-fetching methods.                                                                       |

Note the `minigame` row: the template shows "unregistered" and explains how to wire it, rather than treating it as success and continuing. If your story has `minigame`, you must register the implementation yourself.

## Packaging and distribution

```sh
pwsh -File pack-template.ps1 -SourceDir ./__PROJECT__ -OutputFile ./__PROJECT__.zip
```

Excludes `node_modules/`, `dist/`, `.git/`, `Resources/Saves/`. The last two are runtime artifacts and do not go into the template.

## Template version

`template-meta.json` is the single source of the template version, independent of the engine version:

```json
{
  "version": "1.17.0",
  "minEngineVersion": "0.4.0",
  "placeholder": "__PROJECT__",
  "frameworks": [
    {
      "id": "none",
      "label": "Native (framework-agnostic)",
      "hint": "Use only the skeleton, stacking no framework layer"
    },
    {
      "id": "vue",
      "label": "Vue 3",
      "hint": "The page structure becomes single-file components; assembly and host unchanged",
      "excludes": ["react", "miniprogram"]
    },
    {
      "id": "react",
      "label": "React",
      "hint": "The page structure becomes JSX components; assembly and host unchanged",
      "excludes": ["vue", "miniprogram"]
    }
  ],
  "shells": [
    {
      "id": "browser",
      "label": "Browser",
      "hint": "Generate only a Web project, serving locally with vite"
    },
    {
      "id": "tauri",
      "label": "Desktop (Tauri 2)",
      "hint": "Add a desktop shell to the same project: saves go to the app data directory, page structure unchanged",
      "excludes": ["miniprogram"]
    },
    {
      "id": "miniprogram",
      "label": "Mini program (UniApp)",
      "hint": "The page layer becomes UniApp Vue 3 single-file components; host assembly goes through the mini-program ports",
      "excludes": ["vue", "react", "tauri"]
    }
  ],
  "sources": [
    {
      "id": "ts",
      "label": "TypeScript source (Stories.src)",
      "hint": "Shipped with the skeleton: write story columns in TS, with type completion and refactoring, compiled to story files at build time"
    },
    {
      "id": "story",
      "label": "Attach a hand-written story example",
      "hint": "Add one more .story example, coexisting with the TS source, removing nothing"
    }
  ]
}
```

The first element of each of `frameworks` / `shells` / `sources` is that dimension's default (`sources` does not participate in the shape questions, only deciding whether to additionally attach a story example). `excludes` declares which layers this layer cannot coexist with; the elements are layer `id`s and can reference across dimensions; the exclusivity prompts and legality judgments in the questions are all derived from it, with no whitelist maintained elsewhere. Writing exclusivity on only one side also works; writing it in pairs is so readers can see it at a glance. `minEngineVersion` is the minimum engine version the template requires — check this value before upgrading the engine, because the template may use capabilities only the new engine has.

## Next steps

- [Project structure](/project-structure/): the details of every directory and field.
- [Visual elements](/concepts/elements/): the full type table for that `panel` in the example.
- [Extending the engine](/concepts/extensions/): add your own ops to the engine.
